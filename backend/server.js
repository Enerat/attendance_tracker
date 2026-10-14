require('dotenv').config();

const { createLogger } = require('./logger');
const log = createLogger('server');

if (!process.env.SESSION_SECRET) {
  log.error('SESSION_SECRET environment variable is required.');
  log.error('Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}

const path = require('path');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const session = require('express-session');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const SQLiteStore = require('connect-sqlite3')(session);
const { stringify } = require('csv-stringify/sync');
const db = require('./database');
const { router: authRouter, initOIDC, requireAuth } = require('./auth');
const { normalizeStudent } = require('./normalizeStudent');
const { CHECKIN_METHOD, ROLE, SOCKET_ROOM_PREFIX } = require('./constants');

const app = express();
const server = http.createServer(app);

app.set('trust proxy', 1);

const corsOrigin = process.env.CORS_ORIGIN || '*';
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

log.info('Frontend URL configured as:', frontendUrl);

const io = socketIo(server, {
  path: '/attendance/socket.io',
  cors: {
    origin: corsOrigin.split(',').map(o => o.trim()),
    methods: ['GET', 'POST'],
  }
});

// middleware

app.use('/api/auth/logout/front-channel', (req, res, next) => {
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self' https://id.vut.cz");
  next();
});

app.use(cors({
  origin: corsOrigin.split(',').map(o => o.trim()),
  credentials: true,
}));

app.use(express.json());

const sessionMiddleware = session({
  store: new SQLiteStore({
    db: 'sessions.db',
    dir: process.env.DB_DIR || '.',
  }),
  name: 'attendance.sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
  },
});
app.use(sessionMiddleware);

const allowedOrigins = corsOrigin === '*'
  ? null
  : corsOrigin.split(',').map(o => o.trim());

const csrfLog = createLogger('csrf');

if (!allowedOrigins && process.env.NODE_ENV === 'production') {
  csrfLog.error('CORS_ORIGIN=* is not allowed in production. Set an origin allowlist.');
  process.exit(1);
}

app.use('/api', (req, res, next) => {
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) return next();

  if (!allowedOrigins) {
    return next();
  }

  const origin = req.headers['origin'];

  if (!origin) {
    const host = req.headers['host'];
    const expectedHost = new URL(frontendUrl).host;
    if (host !== expectedHost) {
      csrfLog.warn('Missing Origin header and Host mismatch - rejecting:', host);
      return res.status(403).json({ error: 'Forbidden' });
    }
    return next();
  }

  if (!allowedOrigins.includes(origin)) {
    csrfLog.warn('Rejected request from unexpected origin:', origin);
    return res.status(403).json({ error: 'Forbidden' });
  }

  next();
});

// db
db.initialize();

// auth
app.use('/api/auth', authRouter);

// teachers
app.get('/api/teacher/:id', requireAuth(ROLE.TEACHER), (req, res) => {
  if (parseInt(req.params.id, 10) !== req.user.dbTeacherId) {
    return res.status(403).json({ error: 'Access denied' });
  }
  try {
    const teacher = db.getTeacherById(req.params.id);
    if (!teacher) return res.status(404).json({ error: 'Teacher not found' });
    res.json(teacher);
  } catch (err) {
    log.error('Failed to fetch teacher:', err.message);
    return res.status(500).json({ error: 'Database error' });
  }
});

function requireSessionOwner(req, res, next) {
  try {
    const session = db.getSessionById(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.teacher_id !== req.user.dbTeacherId) {
      return res.status(403).json({ error: 'You do not own this session' });
    }
    req.sessionData = session;
    next();
  } catch (err) {
    log.error('Session lookup failed:', err.message);
    return res.status(500).json({ error: 'Database error' });
  }
}

function requireSubjectOwner(req, res, next) {
  try {
    const subject = db.getSubjectById(req.params.id);
    if (!subject) return res.status(404).json({ error: 'Subject not found' });
    if (subject.teacher_id !== req.user.dbTeacherId) {
      return res.status(403).json({ error: 'You do not own this subject' });
    }
    req.subjectData = subject;
    next();
  } catch (err) {
    log.error('Subject lookup failed:', err.message);
    return res.status(500).json({ error: 'Database error' });
  }
}

function recordAndBroadcast(sessionId, studentId, perId, method, rssi) {
  const checkinId = db.recordCheckInWithMethod(sessionId, studentId, perId, method, rssi);
  const checkin = db.getCheckInById(checkinId);
  io.to(`${SOCKET_ROOM_PREFIX}${sessionId}`).emit('checkin', { sessionId, checkin });
  return checkin;
}

// prefix cells starting with formula chars so spreadsheet apps don't evaluate them
function csvSafe(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  return /^[=+\-@\t\r]/.test(str) ? "'" + str : str;
}

const MAX_FIELD_LEN = 256;
function hasOversizedFields(students) {
  return students.some((s) => {
    if (typeof s === 'string') return s.length > MAX_FIELD_LEN;
    if (!s || typeof s !== 'object') return false;
    return Object.values(s).some((v) => typeof v === 'string' && v.length > MAX_FIELD_LEN);
  });
}

const MAX_ROSTER_SIZE = 1000;

// subjects
app.get('/api/subjects/:id', requireAuth(ROLE.TEACHER), requireSubjectOwner, (req, res) => {
  res.json(req.subjectData);
});

app.get('/api/subjects', requireAuth(ROLE.TEACHER), (req, res) => {
  try {
    const includeArchived = req.query.includeArchived === '1';
    const subjects = db.listSubjects(req.user.dbTeacherId, includeArchived);
    res.json(subjects);
  } catch (err) {
    log.error('Failed to list subjects:', err.message);
    return res.status(500).json({ error: 'Database error' });
  }
});

const MAX_NAME_LEN = 200;

app.post('/api/subjects', requireAuth(ROLE.TEACHER), (req, res) => {
  const { name, code } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
  if (name.length > MAX_NAME_LEN) return res.status(400).json({ error: 'Name too long' });
  if (code && code.length > MAX_NAME_LEN) return res.status(400).json({ error: 'Code too long' });
  try {
    const id = db.createSubject(req.user.dbTeacherId, name.trim(), code ? code.trim() : null);
    res.json({ success: true, id });
  } catch (err) {
    log.error('Failed to create subject:', err.message);
    return res.status(500).json({ error: 'Failed to create subject' });
  }
});

app.patch('/api/subjects/:id', requireAuth(ROLE.TEACHER), requireSubjectOwner, (req, res) => {
  const { name, code } = req.body;
  const fields = {};
  if (name !== undefined) {
    if (!name.trim()) return res.status(400).json({ error: 'Name cannot be empty' });
    if (name.length > MAX_NAME_LEN) return res.status(400).json({ error: 'Name too long' });
    fields.name = name.trim();
  }
  if (code !== undefined) {
    if (code && code.length > MAX_NAME_LEN) return res.status(400).json({ error: 'Code too long' });
    fields.code = code ? code.trim() : null;
  }
  try {
    db.updateSubject(req.params.id, fields);
    res.json({ success: true });
  } catch (err) {
    log.error('Failed to update subject:', err.message);
    return res.status(500).json({ error: 'Failed to update subject' });
  }
});

app.post('/api/subjects/:id/archive', requireAuth(ROLE.TEACHER), requireSubjectOwner, (req, res) => {
  try {
    db.archiveSubject(req.params.id);
    res.json({ success: true });
  } catch (err) {
    log.error('Failed to archive subject:', err.message);
    return res.status(500).json({ error: 'Failed to archive subject' });
  }
});

app.post('/api/subjects/:id/unarchive', requireAuth(ROLE.TEACHER), requireSubjectOwner, (req, res) => {
  try {
    db.unarchiveSubject(req.params.id);
    res.json({ success: true });
  } catch (err) {
    log.error('Failed to unarchive subject:', err.message);
    return res.status(500).json({ error: 'Failed to unarchive subject' });
  }
});

app.get('/api/subjects/:id/students', requireAuth(ROLE.TEACHER), requireSubjectOwner, (req, res) => {
  try {
    const students = db.getSubjectStudents(req.params.id);
    res.json(students);
  } catch (err) {
    log.error('Failed to fetch subject students:', err.message);
    return res.status(500).json({ error: 'Database error' });
  }
});

app.put('/api/subjects/:id/students', requireAuth(ROLE.TEACHER), requireSubjectOwner, (req, res) => {
  const { students } = req.body;
  if (!Array.isArray(students)) return res.status(400).json({ error: 'students array required' });
  if (students.length > MAX_ROSTER_SIZE) {
    return res.status(400).json({ error: `Roster exceeds maximum size of ${MAX_ROSTER_SIZE} students` });
  }
  if (hasOversizedFields(students)) {
    return res.status(400).json({ error: `Roster contains a field longer than ${MAX_FIELD_LEN} characters` });
  }
  try {
    const normalized = students.map(normalizeStudent).filter(s => s.student_id);
    db.replaceSubjectRoster(req.params.id, normalized);
    res.json({ success: true, count: normalized.length });
  } catch (err) {
    log.error('Failed to save roster:', err.message);
    return res.status(500).json({ error: 'Failed to save roster' });
  }
});

// sessions
app.get('/api/session/active', requireAuth(ROLE.TEACHER), (req, res) => {
  try {
    const session = db.getActiveSession(req.user.dbTeacherId);
    if (!session) return res.status(404).json({ error: 'No active session' });
    res.json(session);
  } catch (err) {
    log.error('Failed to fetch active session:', err.message);
    return res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/session/create', requireAuth(ROLE.TEACHER), (req, res) => {
  const { sessionName, subjectId, isActive } = req.body;
  if (!sessionName) return res.status(400).json({ error: 'Session name required' });
  if (sessionName.length > MAX_NAME_LEN) return res.status(400).json({ error: 'Session name too long' });
  const startActive = isActive !== false; // default to active

  try {
    if (subjectId) {
      const subject = db.getSubjectById(subjectId);
      if (!subject || subject.teacher_id !== req.user.dbTeacherId) {
        return res.status(403).json({ error: 'You do not own this subject' });
      }
    }
    const sessionId = db.createSession(sessionName, req.user.dbTeacherId, subjectId || null, startActive);
    res.json({ success: true, sessionId, isActive: startActive, message: 'Session created successfully' });
  } catch (err) {
    log.error('Failed to create session:', err.message);
    return res.status(500).json({ error: 'Failed to create session' });
  }
});

app.post('/api/session/:id/end', requireAuth(ROLE.TEACHER), requireSessionOwner, (req, res) => {
  try {
    db.endSession(req.params.id);
    res.json({ success: true, message: 'Session ended' });
  } catch (err) {
    log.error('Failed to end session:', err.message);
    return res.status(500).json({ error: 'Failed to end session' });
  }
});

app.post('/api/session/:id/activate', requireAuth(ROLE.TEACHER), requireSessionOwner, (req, res) => {
  try {
    db.activateSession(req.params.id, req.user.dbTeacherId);
    res.json({ success: true });
  } catch (err) {
    log.error('Failed to activate session:', err.message);
    return res.status(500).json({ error: 'Failed to activate session' });
  }
});

app.post('/api/session/:id/qr-token', requireAuth(ROLE.TEACHER), requireSessionOwner, (req, res) => {
  if (!req.sessionData.is_active) {
    return res.status(410).json({ error: 'Session has ended' });
  }
  try {
    const raw = Number(req.body.validityMinutes ?? (2 / 60));
    const validityMinutes = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 1) : (2 / 60);
    const tokenData = db.generateQRToken(req.params.id, validityMinutes);
    const qrUrl = `${frontendUrl}?token=${tokenData.token}`;
    res.json({
      success: true,
      token: tokenData.token,
      expiresAt: tokenData.expiresAt,
      qrData: qrUrl,
    });
  } catch (err) {
    log.error('Failed to generate QR token:', err.message);
    return res.status(500).json({ error: 'Failed to generate QR token' });
  }
});

app.get('/api/session/:id/active-token', requireAuth(ROLE.TEACHER), requireSessionOwner, (req, res) => {
  try {
    const token = db.getActiveQRToken(req.params.id);
    if (!token) return res.status(404).json({ error: 'No active token found' });
    const qrUrl = `${frontendUrl}?token=${token.token}`;
    res.json({ token: token.token, expiresAt: token.expires_at, qrData: qrUrl });
  } catch (err) {
    log.error('Failed to fetch active token:', err.message);
    return res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/sessions', requireAuth(ROLE.TEACHER), (req, res) => {
  try {
    const sessions = db.getAllSessions(req.user.dbTeacherId);
    res.json(sessions);
  } catch (err) {
    log.error('Failed to list sessions:', err.message);
    return res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/session/:id/checkins', requireAuth(ROLE.TEACHER), requireSessionOwner, (req, res) => {
  try {
    const checkins = db.getCheckIns(req.params.id);
    res.json(checkins);
  } catch (err) {
    log.error('Failed to fetch checkins:', err.message);
    return res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/session/:id/students', requireAuth(ROLE.TEACHER), requireSessionOwner, (req, res) => {
  const sessionId = req.params.id;
  try {
    const students = db.getStudentListWithStatus(sessionId);
    res.json(students);
  } catch (err) {
    log.error('Failed to fetch student list, trying fallback:', err.message);
    try {
      const checkins = db.getCheckIns(sessionId);
      res.json(checkins.map(c => ({
        student_id: c.student_id,
        per_id: c.per_id || null,
        student_name: null,
        checkin_id: c.id,
        checked_in_at: c.checked_in_at,
        checkin_method: c.checkin_method || CHECKIN_METHOD.QR,
        rssi: c.rssi,
        is_expected: 0,
      })));
    } catch (fallbackErr) {
      log.error('Failed to fetch students (fallback):', fallbackErr.message);
      return res.status(500).json({ error: 'Database error' });
    }
  }
});

app.post('/api/session/:id/students', requireAuth(ROLE.TEACHER), requireSessionOwner, (req, res) => {
  const { students } = req.body;

  if (!students || !Array.isArray(students) || students.length === 0) {
    return res.status(400).json({ error: 'Students array required' });
  }
  if (students.length > MAX_ROSTER_SIZE) {
    return res.status(400).json({ error: `Roster exceeds maximum size of ${MAX_ROSTER_SIZE} students` });
  }
  if (hasOversizedFields(students)) {
    return res.status(400).json({ error: `Roster contains a field longer than ${MAX_FIELD_LEN} characters` });
  }

  try {
    const count = db.addExpectedStudents(req.params.id, students);
    res.json({ success: true, message: `Added ${count} students to expected list`, count });
  } catch (err) {
    log.error('Failed to add students:', err.message);
    return res.status(500).json({ error: 'Failed to add students' });
  }
});

app.post('/api/session/:id/manual-checkin', requireAuth(ROLE.TEACHER), requireSessionOwner, (req, res) => {
  const sessionId = req.params.id;
  const { student_id, per_id } = req.body;

  if (!student_id) return res.status(400).json({ error: 'student_id required' });

  try {
    const checkin = recordAndBroadcast(sessionId, student_id, per_id || null, CHECKIN_METHOD.MANUAL, null);
    res.json({ success: true, checkin });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'Student already checked in' });
    }
    log.error('Failed to record manual check-in:', err.message);
    return res.status(500).json({ error: 'Failed to record check-in' });
  }
});

app.delete('/api/session/:id/checkin', requireAuth(ROLE.TEACHER), requireSessionOwner, (req, res) => {
  const sessionId = req.params.id;
  const { student_id } = req.body;

  if (!student_id) return res.status(400).json({ error: 'student_id required' });

  try {
    const changes = db.deleteCheckIn(sessionId, student_id);
    if (!changes) return res.status(404).json({ error: 'Check-in not found' });
    io.to(`${SOCKET_ROOM_PREFIX}${sessionId}`).emit('checkin', { sessionId, removed: { student_id } });
    res.json({ success: true });
  } catch (err) {
    log.error('Failed to remove check-in:', err.message);
    return res.status(500).json({ error: 'Failed to remove check-in' });
  }
});

app.get('/api/session/:id/export', requireAuth(ROLE.TEACHER), requireSessionOwner, (req, res) => {
  const sessionId = req.params.id;
  const format = req.query.format || 'vut';
  const session = req.sessionData;

  try {
    const students = db.getExportData(sessionId);
    let csv, filename;

    if (format === 'simple') {
      const csvData = students.filter(s => s.checked_in_at).map(s => ({
        'Student ID': csvSafe(s.student_id),
        'Per ID': csvSafe(s.per_id || ''),
        'Check-in Time': csvSafe(s.checked_in_at),
        'Method': csvSafe(s.checkin_method || CHECKIN_METHOD.QR),
      }));
      csv = stringify(csvData, { header: true, columns: ['Student ID', 'Per ID', 'Check-in Time', 'Method'] });
      filename = `attendance_${session.session_name.replace(/[^a-z0-9]/gi, '_')}_${session.id}.csv`;
    } else {
      const sessionDate = new Date(session.created_at).toISOString().split('T')[0];
      const sample = students.find(s => s.dochazka_id && s.dochazka_id.includes('_'));
      const sessionSuffix = sample
        ? sample.dochazka_id.slice(sample.dochazka_id.indexOf('_') + 1)
        : `${session.id}_${sessionDate}_${Date.now()}`;
      const csvData = students.map(s => {
        const status = s.checked_in_at ? 'přítomen' : s.is_expected ? 'nezadáno' : 'nepřítomen';
        const perId = s.per_id || '';
        const dochazkaId = `${perId || s.student_id}_${sessionSuffix}`;
        return {
          'dochazka-id-edit': csvSafe(dochazkaId),
          'jmeno': csvSafe(s.student_name || ''),
          'per-id': csvSafe(perId),
          'rocnik': '',
          'zkratka-stud-skp': '',
          'program': '',
          'zahranicni-cesta': '-',
          'omluvenka': '',
          'stav-pritomnosti': status,
          'poznamka': csvSafe(s.student_id),
        };
      });
      csv = stringify(csvData, {
        header: true,
        delimiter: ';',
        columns: ['dochazka-id-edit', 'jmeno', 'per-id', 'rocnik', 'zkratka-stud-skp', 'program', 'zahranicni-cesta', 'omluvenka', 'stav-pritomnosti', 'poznamka'],
      });
      filename = `dochazka_${session.session_name.replace(/[^a-z0-9]/gi, '_')}_${sessionDate}.csv`;
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\ufeff' + csv);
  } catch (err) {
    log.error('Export failed:', err.message);
    return res.status(500).json({ error: 'Database error' });
  }
});

// student check-in
const checkinRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.session?.user?.login || ipKeyGenerator(req.ip),
  message: { error: 'Too many check-in attempts. Please wait a moment and try again.' },
});

app.post('/api/checkin/qr', requireAuth(ROLE.STUDENT), checkinRateLimiter, (req, res) => {
  const { token } = req.body;
  const studentId = req.user.login;
  const perId = req.user.perId || null;

  if (!token) return res.status(400).json({ error: 'Token required' });

  try {
    const tokenData = db.validateQRToken(token);
    if (!tokenData) {
      return res.status(400).json({ error: 'Invalid or expired QR code. Please scan the latest code.' });
    }

    const sessionId = tokenData.session_id;
    const session = db.getSessionById(sessionId);
    if (!session) return res.status(400).json({ error: 'Invalid session' });
    if (!session.is_active) return res.status(400).json({ error: 'Session has ended' });

    const checkin = recordAndBroadcast(sessionId, studentId, perId, CHECKIN_METHOD.QR, null);

    res.json({
      success: true,
      message: 'Check-in successful',
      checkin,
      sessionId,
      sessionName: session.session_name,
    });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'You have already checked in for this session' });
    }
    log.error('QR check-in failed:', err.message);
    return res.status(500).json({ error: 'Failed to record check-in' });
  }
});

// health
app.get('/api/health', (req, res) => {
  try {
    db.healthCheck();
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  } catch (err) {
    log.error('Database check failed:', err.message);
    res.status(503).json({ status: 'error', error: 'Database unavailable' });
  }
});

// backup
app.post('/api/backup', requireAuth(ROLE.TEACHER), async (req, res) => {
  if (!req.user.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const backupDir = process.env.BACKUP_DIR || path.join(__dirname, 'backups');
  const fs = require('fs');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destPath = path.join(backupDir, `attendance-${timestamp}.db`);

  try {
    await db.backup(destPath);
    res.json({ success: true });
  } catch (err) {
    log.error('Backup failed:', err.message);
    res.status(500).json({ error: 'Backup failed' });
  }
});

// socket.io
// share express session with socket.io so handshake requests carry req.session
const wrapSession = (middleware) => (socket, next) =>
  middleware(socket.request, { setHeader() {}, writeHead() {}, end() {} }, next);
io.use(wrapSession(sessionMiddleware));

const socketLog = createLogger('socket');

io.on('connection', (socket) => {
  socket.use((packet, next) => {
    sessionMiddleware(socket.request, { setHeader() {}, writeHead() {}, end() {} }, () => {
      if (!socket.request.session?.user) {
        socket.disconnect(true);
        return;
      }
      next();
    });
  });

  socketLog.info('Client connected:', socket.id);

  socket.on('join-session', (sessionId) => {
    const user = socket.request.session?.user;
    if (!user || user.role !== ROLE.TEACHER) {
      socketLog.warn('join-session denied - not a teacher:', socket.id);
      return;
    }
    const sid = parseInt(sessionId, 10);
    if (!Number.isInteger(sid)) return;
    try {
      const sessionRow = db.getSessionById(sid);
      if (!sessionRow) return;
      if (sessionRow.teacher_id !== user.dbTeacherId) {
        socketLog.warn(`join-session denied - ${user.login} does not own session ${sid}`);
        return;
      }
      socket.join(`${SOCKET_ROOM_PREFIX}${sid}`);
    } catch (err) {
      socketLog.error('join-session error:', err.message);
    }
  });

  socket.on('leave-session', (sessionId) => {
    socket.leave(`${SOCKET_ROOM_PREFIX}${sessionId}`);
  });

  socket.on('disconnect', () => socketLog.info('Client disconnected:', socket.id));
});

// start
const PORT = process.env.PORT || 3001;

let cleanupIntervalHandle = null;

server.listen(PORT, async () => {
  log.info(`Server running on http://localhost:${PORT}`);
  await initOIDC();

  cleanupIntervalHandle = setInterval(() => {
    try {
      db.cleanupExpiredTokens();
    } catch (err) {
      log.error('Error cleaning up expired tokens:', err);
    }
  }, 30000);
});

// shutdown
function shutdown(signal) {
  log.info(`${signal} received, shutting down`);
  if (cleanupIntervalHandle) {
    clearInterval(cleanupIntervalHandle);
    cleanupIntervalHandle = null;
  }
  const forceTimer = setTimeout(() => {
    log.error('Forced shutdown after timeout');
    db.close();
    process.exit(1);
  }, 5000);
  server.close(() => {
    clearTimeout(forceTimer);
    io.close();
    db.close();
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));