<!-- Author: Jakub Mitrenga -->
# INSTALL

Build and install instructions for the VUT attendance check-in system.

## Overview

The project has three parts that run together:

```
backend/        Node.js + Express + Socket.IO + SQLite (better-sqlite3)
teacher-app/    React + Vite dashboard, uses REST and Socket.IO
student-app/    React + Vite scanner (mobile-first), uses REST
```

The backend serves the JSON API at `/api` and a Socket.IO endpoint at `/attendance/socket.io`. Authentication is handled by the backend through VUT OpenID Connect (`id.vut.cz`); the frontends authenticate via redirect and never see tokens. Live attendance updates are pushed to the teacher app over Socket.IO.

## Prerequisites

- Node.js 20 or newer
- npm 10 or newer
- A POSIX shell for `dev.sh` (Linux or macOS). On Windows use WSL2.
- For production: a reverse proxy that terminates HTTPS (nginx, Caddy) and an OIDC client registered with VUT CVIS.

SQLite is embedded via `better-sqlite3`; the database files are created automatically on first start, so no separate DB server is required.

## 1. Install dependencies

From the app root:

```bash
cd backend     && npm install && cd ..
cd teacher-app && npm install && cd ..
cd student-app && npm install && cd ..
```

This installs each subproject independently. The three `node_modules/` trees are separate.

## 2. Environment configuration

### Backend (`backend/.env`)

The repository includes `.env` files.

The defaults in the examples are tuned for local development. The variables read by the backend:

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `SESSION_SECRET` | yes | none, exits if missing | Cookie signing key. The backend refuses to start without it. |
| `PORT` | no | `3001` | API port. |
| `NODE_ENV` | recommended | `development` | `development` or `production`. In `production`, session cookies are issued as `Secure` + `SameSite=None`, the CORS allowlist is enforced strictly, and DEV BYPASS is disabled. |
| `CORS_ORIGIN` | yes in prod | `*` | Comma-separated allowed origins. The backend exits at startup if `*` and `NODE_ENV=production`. |
| `FRONTEND_URL` | yes in prod | `http://localhost:5173` | Student app URL prefix embedded into rotating QR tokens: the QR encodes `<FRONTEND_URL>?token=...`, so use a trailing slash (`https://<host>/attendance/`) to avoid relying on a reverse-proxy redirect. |
| `DB_PATH` | no | `backend/attendance.db` | SQLite attendance database file path. |
| `DB_DIR` | no | `.` (cwd) | Directory for the session store (`sessions.db`). Independent of `DB_PATH`. |
| `BACKUP_DIR` | no | `backend/backups` | Output directory for `POST /api/backup`. Created on first use. |
| `OIDC_ISSUER` | no | `https://id.vut.cz/auth` | OIDC issuer URL. |
| `OIDC_CLIENT_ID` | yes in prod | empty | VUT OIDC client ID. Empty in dev triggers DEV BYPASS; empty in prod exits at startup. |
| `OIDC_CLIENT_SECRET` | yes in prod | empty | VUT OIDC client secret. Same behavior as `OIDC_CLIENT_ID`. |
| `OIDC_REDIRECT_URI` | yes in prod | `http://localhost:3001/api/auth/callback` | Must match the URI registered with CVIS. |
| `FRONTEND_STUDENT_URL` | yes in prod | `http://localhost:5173/` | Redirect target after a successful student login. |
| `FRONTEND_TEACHER_URL` | yes in prod | `http://localhost:5174/` | Redirect target after a successful teacher login. |
| `ADMIN_LOGINS` | no | empty | VUT logins that bypass the staff affiliation check and are flagged as admin. |

DEV BYPASS: if `OIDC_CLIENT_ID` or `OIDC_CLIENT_SECRET` are empty and `NODE_ENV` is not `production`, the backend logs a warning and runs in bypass mode. In that mode `GET /api/auth/login?role=teacher` creates a fake teacher session for `xteach01` (flagged admin) and `?role=student` creates a fake student session for `xstude01`.

OIDC scopes requested from the issuer: `openid email personAffiliation`. The client registration must allow these scopes and the configured `OIDC_REDIRECT_URI`.

### Frontends (`teacher-app/.env`, `student-app/.env`)

Variables are read at Vite build time:

| Variable | Used by | Default | Purpose |
|---|---|---|---|
| `VITE_API_URL` | both apps | `http://localhost:3001/api` | Backend API base URL. |
| `VITE_SOCKET_URL` | teacher-app | `http://localhost:3001` | Backend host for the Socket.IO connection. |
| `VITE_SOCKET_PATH` | teacher-app | `/socket.io` (fallback) | Set to `/attendance/socket.io` to match the backend. |

The Vite base paths are set in each app's `vite.config.js` and determine the URL prefix where the built assets must be served:

- `student-app`: `/attendance/`
- `teacher-app`: `/attendance/teacher/`

## 3. Run in development

```bash
./dev.sh
```

This launches all three services in parallel and forwards Ctrl+C to all of them:

- Backend on `http://localhost:3001`
- Student app on `http://localhost:5173/attendance/`
- Teacher app on `http://localhost:5174/attendance/teacher/`

`dev.sh` runs the backend as `node server.js`. For backend hot-reload during development, run each service in its own terminal instead:

```bash
cd backend     && npm run dev   # nodemon server.js
cd teacher-app && npm run dev   # vite
cd student-app && npm run dev   # vite
```

## 4. Build for production

```bash
cd teacher-app && npm run build   # output: teacher-app/dist
cd student-app && npm run build   # output: student-app/dist
cd backend     && npm start       # node server.js: API + Socket.IO
```

The backend serves only the API and Socket.IO; it does not serve the static frontends. Behind a reverse proxy, the whole app is mounted under a single public `/attendance/` prefix:

- `/attendance/`           serves the student SPA from `student-app/dist`
- `/attendance/teacher/`   serves the teacher SPA from `teacher-app/dist`
- `/attendance/api/`       proxies to the backend. The backend listens at `/api/`, so the reverse proxy must strip the `/attendance` prefix.
- `/attendance/socket.io/` proxies to the backend (WebSocket upgrade required). The backend listens at exactly this path, no rewrite.

Production checklist for `backend/.env`:

- Set `NODE_ENV=production` so cookies are issued with `Secure` and `SameSite=None`.
- Generate a strong `SESSION_SECRET`:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
- Set `CORS_ORIGIN` to the exact public origin. `*` is rejected at startup.
- Set `FRONTEND_URL` to the deployed student app URL
- Set `FRONTEND_STUDENT_URL` and `FRONTEND_TEACHER_URL` to the deployed HTTPS URLs
- Register `OIDC_REDIRECT_URI` with CVIS and put the matching value in `.env`. It must go through the public proxy path, e.g. `https://<host>/attendance/api/auth/callback`.
- Optionally set `ADMIN_LOGINS=xlogin00,xlogin01` to grant admin to specific VUT logins.

The session cookie is named `attendance.sid` and lasts 8 hours. Sessions are stored in `sessions.db` (location controlled by `DB_DIR`); attendance data is stored in `attendance.db` (location controlled by `DB_PATH`). Both files use SQLite WAL mode.

## 5. Verify the install

With `./dev.sh` running:

1. Open `http://localhost:5174/attendance/teacher/` (teacher app). Click "Sign in with VUT". In DEV BYPASS you will be logged in as `xteach01` (admin).
2. Create a session with "New Session" on the Sessions tab, then click the QR button to open the rotating code.
3. Open `http://localhost:5173/attendance/` (student app). Click "Sign in with VUT". Scan the rotating QR with a device on the same network.
4. The check-in appears in the teacher's attendance list.
