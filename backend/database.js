const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');
const { createLogger } = require('./logger');
const { normalizeStudent } = require('./normalizeStudent');

const log = createLogger('db');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'attendance.db');
const db = new Database(dbPath);
log.info('Connected to SQLite database');

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const MIGRATIONS = [
  {
    version: 1,
    name: 'initial_schema',
    up: (d) => {
      d.exec(`
        CREATE TABLE IF NOT EXISTS teachers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          teacher_id TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          surname TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_name TEXT NOT NULL,
          beacon_uuid TEXT,
          teacher_id INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          is_active BOOLEAN DEFAULT 1,
          FOREIGN KEY (teacher_id) REFERENCES teachers(id)
        );
        CREATE TABLE IF NOT EXISTS checkins (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id INTEGER NOT NULL,
          student_id TEXT NOT NULL,
          per_id TEXT,
          rssi INTEGER,
          checkin_method TEXT DEFAULT 'qr',
          checked_in_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (session_id) REFERENCES sessions(id),
          UNIQUE(session_id, student_id)
        );
        CREATE TABLE IF NOT EXISTS qr_tokens (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id INTEGER NOT NULL,
          token TEXT NOT NULL UNIQUE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          expires_at DATETIME NOT NULL,
          FOREIGN KEY (session_id) REFERENCES sessions(id)
        );
        CREATE TABLE IF NOT EXISTS expected_students (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id INTEGER NOT NULL,
          student_id TEXT NOT NULL,
          per_id TEXT,
          student_name TEXT,
          FOREIGN KEY (session_id) REFERENCES sessions(id),
          UNIQUE(session_id, student_id)
        );
      `);
    },
  },
  {
    version: 2,
    name: 'subjects',
    up: (d) => {
      d.exec(`
        CREATE TABLE IF NOT EXISTS subjects (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          teacher_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          code TEXT,
          archived_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (teacher_id) REFERENCES teachers(id)
        );
        CREATE TABLE IF NOT EXISTS subject_students (
          subject_id INTEGER NOT NULL,
          student_id TEXT NOT NULL,
          per_id TEXT,
          student_name TEXT,
          PRIMARY KEY (subject_id, student_id),
          FOREIGN KEY (subject_id) REFERENCES subjects(id)
        );
      `);
      const cols = d.prepare("PRAGMA table_info(sessions)").all().map(c => c.name);
      if (!cols.includes('subject_id')) {
        d.exec('ALTER TABLE sessions ADD COLUMN subject_id INTEGER REFERENCES subjects(id)');
      }
    },
  },
  {
    version: 3,
    name: 'hot_path_indexes',
    up: (d) => {
      d.exec(`
        CREATE INDEX IF NOT EXISTS idx_checkins_session ON checkins(session_id);
        CREATE INDEX IF NOT EXISTS idx_expected_students_session ON expected_students(session_id);
        CREATE INDEX IF NOT EXISTS idx_qr_tokens_session ON qr_tokens(session_id);
        CREATE INDEX IF NOT EXISTS idx_qr_tokens_expires_at ON qr_tokens(expires_at);
        CREATE INDEX IF NOT EXISTS idx_sessions_teacher ON sessions(teacher_id);
        CREATE INDEX IF NOT EXISTS idx_subject_students_subject ON subject_students(subject_id);
      `);
    },
  },
  {
    version: 4,
    name: 'expected_students_dochazka_id',
    up: (d) => {
      const cols = d.prepare("PRAGMA table_info(expected_students)").all().map(c => c.name);
      if (!cols.includes('dochazka_id')) {
        d.exec('ALTER TABLE expected_students ADD COLUMN dochazka_id TEXT');
      }
    },
  },
  {
    version: 5,
    name: 'drop_qr_tokens_is_used',
    up: (d) => {
      const cols = d.prepare("PRAGMA table_info(qr_tokens)").all().map(c => c.name);
      if (cols.includes('is_used')) {
        d.exec('ALTER TABLE qr_tokens DROP COLUMN is_used');
      }
    },
  },
];

function initialize() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version)
  );
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    const tx = db.transaction(() => {
      m.up(db);
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(m.version, m.name);
    });
    tx();
    log.info(`Applied migration ${m.version}: ${m.name}`);
  }
  log.info('Database tables ready');
}

// teachers
function createTeacher(teacherId, name, surname) {
  const now = new Date().toISOString();
  const result = db.prepare(
    'INSERT INTO teachers (teacher_id, name, surname, created_at) VALUES (?, ?, ?, ?)'
  ).run(teacherId, name, surname, now);
  return result.lastInsertRowid;
}

function getTeacherById(id) {
  return db.prepare('SELECT * FROM teachers WHERE id = ?').get(id);
}

function getTeacherByTeacherId(teacherId) {
  return db.prepare('SELECT * FROM teachers WHERE teacher_id = ?').get(teacherId);
}

// sessions
function createSession(sessionName, teacherId, subjectId, isActive) {
  const now = new Date().toISOString();
  const active = isActive ? 1 : 0;
  const tx = db.transaction(() => {
    if (active) {
      db.prepare('UPDATE sessions SET is_active = 0 WHERE teacher_id = ?').run(teacherId);
    }
    const result = db.prepare(
      'INSERT INTO sessions (session_name, teacher_id, subject_id, is_active, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(sessionName, teacherId, subjectId || null, active, now);
    const sessionId = result.lastInsertRowid;

    // sort by name so display_number 1 is the first student alphabetically
    if (subjectId) {
      const roster = db.prepare(`
        SELECT student_id, per_id, student_name FROM subject_students
        WHERE subject_id = ?
        ORDER BY
          CASE WHEN student_name IS NULL OR student_name = '' THEN 1 ELSE 0 END,
          student_name COLLATE NOCASE,
          student_id COLLATE NOCASE
      `).all(subjectId);
      const insert = db.prepare(
        'INSERT OR REPLACE INTO expected_students (session_id, student_id, per_id, student_name) VALUES (?, ?, ?, ?)'
      );
      for (const s of roster) insert.run(sessionId, s.student_id, s.per_id, s.student_name);
    }

    return sessionId;
  });
  return tx();
}

function endSession(sessionId) {
  return db.prepare('UPDATE sessions SET is_active = 0 WHERE id = ?').run(sessionId).changes;
}

function activateSession(sessionId, teacherId) {
  const tx = db.transaction(() => {
    db.prepare('UPDATE sessions SET is_active = 0 WHERE teacher_id = ?').run(teacherId);
    return db.prepare('UPDATE sessions SET is_active = 1 WHERE id = ?').run(sessionId).changes;
  });
  return tx();
}

function getActiveSession(teacherId) {
  return db.prepare(
    'SELECT * FROM sessions WHERE is_active = 1 AND teacher_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(teacherId);
}

function getAllSessions(teacherId) {
  return db.prepare(`
    SELECT s.*,
      t.name as teacher_name, t.surname as teacher_surname,
      sub.name as subject_name, sub.code as subject_code,
      COUNT(c.id) as checkin_count
    FROM sessions s
    LEFT JOIN checkins c ON s.id = c.session_id
    LEFT JOIN teachers t ON s.teacher_id = t.id
    LEFT JOIN subjects sub ON s.subject_id = sub.id
    WHERE s.teacher_id = ?
    GROUP BY s.id
    ORDER BY s.created_at DESC
  `).all(teacherId);
}

function getSessionById(sessionId) {
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
}

// check-ins
function recordCheckInWithMethod(sessionId, studentId, perId, method, rssi) {
  const now = new Date().toISOString();
  const result = db.prepare(
    'INSERT INTO checkins (session_id, student_id, per_id, checkin_method, rssi, checked_in_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(sessionId, studentId, perId || null, method, rssi, now);
  return result.lastInsertRowid;
}

function getCheckIns(sessionId) {
  return db.prepare(
    'SELECT * FROM checkins WHERE session_id = ? ORDER BY checked_in_at DESC'
  ).all(sessionId);
}

function getCheckInById(checkinId) {
  return db.prepare('SELECT * FROM checkins WHERE id = ?').get(checkinId);
}

function deleteCheckIn(sessionId, studentId) {
  return db.prepare(
    'DELETE FROM checkins WHERE session_id = ? AND student_id = ?'
  ).run(sessionId, studentId).changes;
}

// qr tokens
function generateQRToken(sessionId, validityMinutes) {
  const now = new Date();
  const token = crypto.randomBytes(8).toString('hex');
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + validityMinutes * 60 * 1000).toISOString();
  const result = db.prepare(
    'INSERT INTO qr_tokens (session_id, token, created_at, expires_at) VALUES (?, ?, ?, ?)'
  ).run(sessionId, token, createdAt, expiresAt);
  return { token, expiresAt, tokenId: result.lastInsertRowid };
}

function getActiveQRToken(sessionId) {
  const now = new Date().toISOString();
  return db.prepare(`
    SELECT * FROM qr_tokens
    WHERE session_id = ? AND expires_at > ?
    ORDER BY created_at DESC LIMIT 1
  `).get(sessionId, now);
}

function validateQRToken(token) {
  const now = new Date().toISOString();
  return db.prepare(`
    SELECT * FROM qr_tokens
    WHERE token = ? AND expires_at > ?
  `).get(token, now);
}

function cleanupExpiredTokens() {
  const now = new Date().toISOString();
  const result = db.prepare('DELETE FROM qr_tokens WHERE expires_at < ?').run(now);
  if (result.changes > 0) log.info(`Cleaned up ${result.changes} expired QR tokens`);
  return result.changes;
}

// expected students
function addExpectedStudents(sessionId, students) {
  const normalized = students.map(normalizeStudent).filter(s => s.student_id);

  const insert = db.prepare(
    'INSERT OR REPLACE INTO expected_students (session_id, student_id, per_id, student_name, dochazka_id) VALUES (?, ?, ?, ?, ?)'
  );

  const insertMany = db.transaction((rows) => {
    for (const s of rows) insert.run(sessionId, s.student_id, s.per_id, s.student_name, s.dochazka_id);
    return rows.length;
  });

  return insertMany(normalized);
}

function getStudentListWithStatus(sessionId) {
  return db.prepare(`
    SELECT * FROM (
      SELECT
        es.student_id,
        COALESCE(es.per_id, c.per_id) as per_id,
        es.student_name,
        c.id as checkin_id, c.checked_in_at, c.checkin_method, c.rssi,
        1 as is_expected,
        ROW_NUMBER() OVER (ORDER BY es.id) as display_number
      FROM expected_students es
      LEFT JOIN checkins c ON (
        es.student_id = c.student_id
        OR (es.per_id IS NOT NULL AND c.per_id IS NOT NULL AND es.per_id = c.per_id)
      ) AND es.session_id = c.session_id
      WHERE es.session_id = ?

      UNION ALL

      SELECT
        c.student_id,
        c.per_id,
        NULL as student_name,
        c.id as checkin_id, c.checked_in_at, c.checkin_method, c.rssi,
        0 as is_expected,
        (SELECT COUNT(*) FROM expected_students WHERE session_id = ?)
          + ROW_NUMBER() OVER (ORDER BY c.id) as display_number
      FROM checkins c
      WHERE c.session_id = ?
      AND c.student_id NOT IN (
        SELECT student_id FROM expected_students WHERE session_id = ?
      )
      AND (c.per_id IS NULL OR c.per_id NOT IN (
        SELECT per_id FROM expected_students WHERE session_id = ? AND per_id IS NOT NULL
      ))
    ) AS combined
    ORDER BY
      CASE WHEN checked_in_at IS NULL THEN 0 ELSE 1 END,
      checked_in_at DESC
  `).all(sessionId, sessionId, sessionId, sessionId, sessionId);
}

function getExportData(sessionId) {
  return db.prepare(`
    SELECT
      es.student_id,
      COALESCE(es.per_id, c.per_id) as per_id,
      es.student_name,
      es.dochazka_id,
      c.id as checkin_id, c.checked_in_at, c.checkin_method,
      1 as is_expected
    FROM expected_students es
    LEFT JOIN checkins c ON (
      es.student_id = c.student_id
      OR (es.per_id IS NOT NULL AND c.per_id IS NOT NULL AND es.per_id = c.per_id)
    ) AND es.session_id = c.session_id
    WHERE es.session_id = ?

    UNION

    SELECT
      c.student_id,
      c.per_id,
      NULL as student_name,
      NULL as dochazka_id,
      c.id as checkin_id, c.checked_in_at, c.checkin_method,
      0 as is_expected
    FROM checkins c
    WHERE c.session_id = ?
    AND c.student_id NOT IN (
      SELECT student_id FROM expected_students WHERE session_id = ?
    )
    AND (c.per_id IS NULL OR c.per_id NOT IN (
      SELECT per_id FROM expected_students WHERE session_id = ? AND per_id IS NOT NULL
    ))
    ORDER BY student_id
  `).all(sessionId, sessionId, sessionId, sessionId);
}

// subjects
function createSubject(teacherId, name, code) {
  const result = db.prepare(
    'INSERT INTO subjects (teacher_id, name, code) VALUES (?, ?, ?)'
  ).run(teacherId, name, code || null);
  return result.lastInsertRowid;
}

function listSubjects(teacherId, includeArchived) {
  const base = `
    SELECT s.*, COUNT(ss.student_id) as student_count
    FROM subjects s
    LEFT JOIN subject_students ss ON s.id = ss.subject_id
    WHERE s.teacher_id = ?
  `;
  const sql = includeArchived
    ? `${base} GROUP BY s.id ORDER BY s.archived_at IS NULL DESC, s.name`
    : `${base} AND s.archived_at IS NULL GROUP BY s.id ORDER BY s.name`;
  return db.prepare(sql).all(teacherId);
}

function getSubjectById(subjectId) {
  return db.prepare('SELECT * FROM subjects WHERE id = ?').get(subjectId);
}

function updateSubject(subjectId, fields) {
  const sets = [];
  const values = [];
  if (fields.name !== undefined) { sets.push('name = ?'); values.push(fields.name); }
  if (fields.code !== undefined) { sets.push('code = ?'); values.push(fields.code || null); }
  if (sets.length === 0) return 0;
  values.push(subjectId);
  return db.prepare(`UPDATE subjects SET ${sets.join(', ')} WHERE id = ?`).run(...values).changes;
}

function archiveSubject(subjectId) {
  return db.prepare(
    'UPDATE subjects SET archived_at = ? WHERE id = ?'
  ).run(new Date().toISOString(), subjectId).changes;
}

function unarchiveSubject(subjectId) {
  return db.prepare(
    'UPDATE subjects SET archived_at = NULL WHERE id = ?'
  ).run(subjectId).changes;
}

function getSubjectStudents(subjectId) {
  return db.prepare(
    'SELECT student_id, per_id, student_name FROM subject_students WHERE subject_id = ? ORDER BY student_id'
  ).all(subjectId);
}

function replaceSubjectRoster(subjectId, students) {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM subject_students WHERE subject_id = ?').run(subjectId);
    const insert = db.prepare(
      'INSERT OR REPLACE INTO subject_students (subject_id, student_id, per_id, student_name) VALUES (?, ?, ?, ?)'
    );
    for (const s of students) {
      if (!s.student_id) continue;
      insert.run(subjectId, s.student_id, s.per_id || null, s.student_name || null);
    }
    return students.length;
  });
  return tx();
}

// utility
function healthCheck() {
  db.prepare('SELECT 1').get();
}

function backup(destPath) {
  return db.backup(destPath);
}

function close() {
  db.close();
  log.info('Database connection closed');
}

module.exports = {
  initialize,
  healthCheck,
  backup,
  close,
  createTeacher,
  getTeacherById,
  getTeacherByTeacherId,
  createSession,
  endSession,
  activateSession,
  getActiveSession,
  getAllSessions,
  getSessionById,
  recordCheckInWithMethod,
  getCheckIns,
  getCheckInById,
  deleteCheckIn,
  generateQRToken,
  getActiveQRToken,
  validateQRToken,
  cleanupExpiredTokens,
  addExpectedStudents,
  getStudentListWithStatus,
  getExportData,
  createSubject,
  listSubjects,
  getSubjectById,
  updateSubject,
  archiveSubject,
  unarchiveSubject,
  getSubjectStudents,
  replaceSubjectRoster,
};