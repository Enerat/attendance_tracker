const { Issuer, generators } = require('openid-client');
const express = require('express');
const db = require('./database');
const { createLogger } = require('./logger');
const { ROLE, AFFILIATION, STUDENT_AFFILIATIONS } = require('./constants');

const log = createLogger('auth');
const router = express.Router();

const IS_PROD = process.env.NODE_ENV === 'production';
const ISSUER_URL = process.env.OIDC_ISSUER || 'https://id.vut.cz/auth';
const CLIENT_ID = process.env.OIDC_CLIENT_ID;
const CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET;
const REDIRECT_URI = process.env.OIDC_REDIRECT_URI || 'http://localhost:3001/api/auth/callback';
const FRONTEND_STUDENT_URL = process.env.FRONTEND_STUDENT_URL || 'http://localhost:5173/';
const FRONTEND_TEACHER_URL = process.env.FRONTEND_TEACHER_URL || 'http://localhost:5174/';

let oidcClient = null;
let endSessionEndpoint = null;

async function initOIDC() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    if (IS_PROD) {
      log.error('OIDC_CLIENT_ID or OIDC_CLIENT_SECRET not set in production. Exiting.');
      process.exit(1);
    }
    log.warn('OIDC credentials not set. Running in DEV BYPASS mode.');
    log.warn('Any /api/auth/login call will create a fake session without VUT SSO.');
    return false;
  }

  try {
    const issuer = await Issuer.discover(ISSUER_URL);
    log.info('Discovered OIDC issuer:', issuer.issuer);

    endSessionEndpoint = issuer.end_session_endpoint;
    log.info('End session endpoint:', endSessionEndpoint);

    oidcClient = new issuer.Client({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uris: [REDIRECT_URI],
      response_types: ['code'],
    });

    log.info('OIDC client initialized');
    return true;
  } catch (err) {
    log.error('Failed to initialize OIDC client:', err.message);
    if (IS_PROD) {
      log.error('Cannot start without OIDC in production. Exiting.');
      process.exit(1);
    }
    log.warn('Falling back to DEV BYPASS mode.');
    return false;
  }
}

function getAdminLogins() {
  return (process.env.ADMIN_LOGINS || '')
    .split(',')
    .map(l => l.trim().toLowerCase())
    .filter(Boolean);
}

function extractLogin(claims) {
  const fromUsername = (claims.preferred_username || '').split('@')[0].toLowerCase();
  if (fromUsername) return fromUsername;

  const fromEmail = (claims.email || '').split('@')[0].toLowerCase();
  if (fromEmail) return fromEmail;

  log.error('Could not extract login. preferred_username:', claims.preferred_username, 'email:', claims.email);
  throw new Error('Could not determine VUT login from SSO claims');
}

function extractAffiliations(claims) {
  const raw = claims.personAffiliation || [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr
    .filter(Boolean)
    .map(a => a.split('@')[0].toLowerCase());
}

function isStaff(affiliations) {
  return affiliations.includes(AFFILIATION.STAFF);
}

function isStudent(affiliations) {
  return affiliations.some(a => STUDENT_AFFILIATIONS.includes(a));
}

function syncTeacherToDB(login, name) {
  const existing = db.getTeacherByTeacherId(login);
  if (existing) return existing.id;

  let firstName, surname;
  if (!name || name === login) {
    firstName = login;
    surname = '';
  } else {
    const parts = name.trim().split(' ');
    surname = parts.pop() || '';
    firstName = parts.join(' ') || login;
  }

  try {
    return db.createTeacher(login, firstName, surname);
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      // race condition: another request inserted first
      const teacher = db.getTeacherByTeacherId(login);
      if (teacher) return teacher.id;
    }
    throw err;
  }
}

function requireAuth(role) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (role && req.session.user.role !== role) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    req.user = req.session.user;
    next();
  };
}

router.get('/login', async (req, res) => {
  const role = req.query.role === ROLE.TEACHER ? ROLE.TEACHER : ROLE.STUDENT;

  if (!oidcClient) {
    const fakeLogin = role === ROLE.TEACHER ? 'xteach01' : 'xstude01';
    const fakeName = role === ROLE.TEACHER ? 'Test Teacher' : 'Test Student';
    const isAdmin = role === ROLE.TEACHER;
    const sessionUser = { login: fakeLogin, name: fakeName, role, isAdmin };

    if (role === ROLE.TEACHER) {
      try {
        sessionUser.dbTeacherId = syncTeacherToDB(fakeLogin, fakeName);
      } catch (err) {
        log.error('Dev bypass teacher sync failed:', err.message);
      }
    }

    return req.session.regenerate((regenErr) => {
      if (regenErr) {
        log.error('Failed to regenerate dev bypass session:', regenErr);
        return res.redirect(role === ROLE.TEACHER ? FRONTEND_TEACHER_URL : FRONTEND_STUDENT_URL);
      }
      req.session.user = sessionUser;
      req.session.save((err) => {
        if (err) log.error('Failed to save dev bypass session:', err);
        res.redirect(role === ROLE.TEACHER ? FRONTEND_TEACHER_URL : FRONTEND_STUDENT_URL);
      });
    });
  }

  const nonce = generators.nonce();
  const state = generators.state();
  req.session.oidc = { nonce, state, role };

  const authUrl = oidcClient.authorizationUrl({
    scope: 'openid email personAffiliation',
    state,
    nonce,
  });

  req.session.save((err) => {
    if (err) {
      log.error('Failed to save session before OIDC redirect:', err);
      const errorUrl = role === ROLE.TEACHER ? FRONTEND_TEACHER_URL : FRONTEND_STUDENT_URL;
      return res.redirect(`${errorUrl}?auth_error=session_missing`);
    }
    res.redirect(authUrl);
  });
});

router.get('/callback', async (req, res) => {
  const oidcSession = req.session.oidc;
  if (!oidcSession || !oidcClient) {
    return res.redirect(`${FRONTEND_STUDENT_URL}?auth_error=session_missing`);
  }

  const { nonce, state, role } = oidcSession;
  delete req.session.oidc;

  try {
    const params = oidcClient.callbackParams(req);
    const tokenSet = await oidcClient.callback(REDIRECT_URI, params, { nonce, state });
    const claims = tokenSet.claims();

    if (!IS_PROD) {
      log.info('Token claims for:', claims.preferred_username || claims.sub);
    }

    const login = extractLogin(claims);
    const affiliations = extractAffiliations(claims);
    const name = claims.name
      || `${claims.given_name || ''} ${claims.family_name || ''}`.trim()
      || login;

    const perId = claims.sub || null;

    const adminLogins = getAdminLogins();
    const isAdmin = adminLogins.includes(login);

    if (isAdmin) {
      log.info(`Admin access granted for ${login}`);
    }

    log.info(`Login: ${login}, perId: ${perId}, affiliations: ${affiliations.join(', ')}, role: ${role}, admin: ${isAdmin}`);

    if (role === ROLE.TEACHER && !isStaff(affiliations) && !isAdmin) {
      log.warn(`Denied teacher access for ${login}: affiliations=${affiliations.join(', ')}`);
      return res.redirect(`${FRONTEND_TEACHER_URL}?auth_error=not_staff`);
    }

    if (role === ROLE.STUDENT && !isStudent(affiliations) && !isStaff(affiliations) && !isAdmin) {
      log.warn(`Denied student access for ${login}: affiliations=${affiliations.join(', ')}`);
      return res.redirect(`${FRONTEND_STUDENT_URL}?auth_error=not_student`);
    }

    const sessionUser = { login, name, role, perId, isAdmin };

    if (role === ROLE.TEACHER) {
      try {
        sessionUser.dbTeacherId = syncTeacherToDB(login, name);
      } catch (err) {
        log.error('Teacher sync failed during callback:', err.message);
        return res.redirect(`${FRONTEND_TEACHER_URL}?auth_error=sync_failed`);
      }
    }

    const oidcSid = claims.sid || null;

    req.session.regenerate((regenErr) => {
      if (regenErr) {
        log.error('Failed to regenerate session after callback:', regenErr);
        const errorUrl = role === ROLE.TEACHER ? FRONTEND_TEACHER_URL : FRONTEND_STUDENT_URL;
        return res.redirect(`${errorUrl}?auth_error=callback_failed`);
      }

      req.session.user = sessionUser;
      if (oidcSid) req.session.oidcSid = oidcSid;
      if (tokenSet.id_token) req.session.idToken = tokenSet.id_token;

      req.session.save((err) => {
        if (err) {
          log.error('Failed to save session after callback:', err);
          const errorUrl = role === ROLE.TEACHER ? FRONTEND_TEACHER_URL : FRONTEND_STUDENT_URL;
          return res.redirect(`${errorUrl}?auth_error=callback_failed`);
        }
        return res.redirect(role === ROLE.TEACHER ? FRONTEND_TEACHER_URL : FRONTEND_STUDENT_URL);
      });
    });

  } catch (err) {
    log.error('Callback error:', err.message);
    const errorUrl = role === ROLE.TEACHER ? FRONTEND_TEACHER_URL : FRONTEND_STUDENT_URL;
    return res.redirect(`${errorUrl}?auth_error=callback_failed`);
  }
});

router.get('/me', (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.json(req.session.user);
});

router.post('/logout', (req, res) => {
  const role = req.session?.user?.role;
  const idToken = req.session?.idToken || null;

  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: 'Logout failed' });

    res.clearCookie('attendance.sid');

    const postLogoutUrl = role === ROLE.TEACHER ? FRONTEND_TEACHER_URL : FRONTEND_STUDENT_URL;
    let ssoLogoutUrl = null;
    if (oidcClient && endSessionEndpoint) {
      ssoLogoutUrl = oidcClient.endSessionUrl({
        id_token_hint: idToken || undefined,
        post_logout_redirect_uri: postLogoutUrl,
      });
    }

    res.json({ success: true, ssoLogoutUrl });
  });
});

router.get('/logout/front-channel', (req, res) => {
  const { iss, sid } = req.query;

  if (IS_PROD) {
    // OIDC spec marks iss/sid as optional, but in production we want at least
    // an issuer match so a random page navigating here can't force a logout.
    if (!iss || iss !== ISSUER_URL) {
      log.warn('Front-channel logout: missing or unexpected issuer:', iss);
      return res.status(400).send('');
    }
  } else if (iss && iss !== ISSUER_URL) {
    log.warn('Front-channel logout: unexpected issuer:', iss);
    return res.status(400).send('');
  }

  if (!req.session) {
    return res.status(200).send('');
  }

  const storedSid = req.session.oidcSid;
  if (sid && storedSid && sid !== storedSid) {
    log.warn('Front-channel logout: sid mismatch, ignoring');
    return res.status(200).send('');
  }

  const login = req.session.user?.login || '(unknown)';
  req.session.destroy((err) => {
    if (err) {
      log.error('Front-channel logout: session destroy error for', login, err);
    } else {
      log.info('Front-channel logout: destroyed session for', login);
    }
    res.status(200).send('');
  });
});

router.get('/status', (req, res) => {
  res.json({
    ssoAvailable: oidcClient !== null,
    devBypass: oidcClient === null && !IS_PROD,
  });
});

module.exports = { router, initOIDC, requireAuth };