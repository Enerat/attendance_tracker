<!-- Author: Jakub Mitrenga -->
# USAGE

Operating guide for the VUT attendance check-in system.

## Roles

The system has two user-facing roles plus an admin override:

- **Teacher** uses the teacher app to create lecture sessions, display the rotating QR code, and review attendance.
- **Student** uses the student app to scan the QR shown in the lecture hall and check in.
- **Admin** is any login listed in the backend's `ADMIN_LOGINS` env var. Admins bypass the "must be VUT staff" check and can sign into the teacher app even with a student affiliation. Used for demonstrations.

Both apps authenticate through VUT SSO (`id.vut.cz`). In local development without OIDC credentials configured, the backend runs in DEV BYPASS mode and assigns fake identities: `xteach01` (teacher) or `xstude01` (student). See INSTALL.md.

## URLs

In development:

- Teacher: `http://localhost:5174/attendance/teacher/`
- Student: `http://localhost:5173/attendance/`
- API: `http://localhost:3001/api`

In production these are the deployed HTTPS URLs.

## Teacher workflow

### Signing in

1. Open the teacher app and click "Sign in with VUT".
2. Authenticate via VUT SSO. Non-staff accounts are rejected unless your login is in `ADMIN_LOGINS`.
3. You land on the dashboard. The top header has tabs: Active, Sessions, Subjects. Right-side buttons appear when a session is running: QR (orange, primary), End session. The theme toggle and account menu is shown when logged in.

### Subjects (optional)

A Subject is a reusable lecture with a roster attached.

1. Go to the Subjects tab and click "New Subject". Give it a name and an optional short code (e.g. `IIS`).
2. The subject editor opens. Upload the student roster in any of three formats:
   - **VUT export with header**: the CSV that VUT IS produces, with a header row like `dochazka-id-edit;jmeno;per-id;...`
   - **Simpler `per-id;name`** per line, e.g. `123456;Jan Novak`
   - **Bare identifiers**: one xlogin or 5/6-digit per-id per line
3. You can search subjects by name or code, and toggle "Show archived" to see retired ones.

Picking a subject when creating a session auto-fills both the session name and the student list.

### Creating a session

1. Sessions tab -> "New Session".
2. Type a name (or pick a Subject - the name auto-fills as `Subject name - YYYY-MM-DD` until you edit it).
3. "Start now" controls whether the session becomes active. Leave checked for normal use; uncheck to pre-create a session for later.
4. If you didn't pick a Subject, paste or upload the student roster directly. Skip the roster entirely if you want to accept any check-in (every check-in will then show as orange "Unexpected").
5. Click "Create & Start" (or "Create").

Starting a new session while another is active prompts to switch, the previous session is ended.

### Running an active session

The Active tab shows the live attendance list while a session is running.

orange QR button: opens a popup window with the rotating QR code. Put this window on the projector. Tokens are valid for 2 seconds and refreshed every half second. An expired token cannot be used to check in. The popup also shows a small live counter and list of recent check-ins.

Active list columns:
- **#** display number
- **Name** (if available from the roster)
- **Login** (xlogin, if set)
- **ID** (per-id)
- **Status**: Waiting (red), Present (green), Unexpected (yellow - check-in from someone not on the roster)
- **Check-in time**
- **Action**: manual check-in (checkmark) for waiting students, remove (x) for already checked-in students

Controls above the list:
- Search by name, login, or per-id
- Sort by Status, Time, Login, or Name
- Upload extra students (ADDED to the roster mid-session)
- Download CSV (VUT-format export)

Stats above the list show: Expected (roster size), Present (checked in), Unexpected (checked in but not on roster).

### Ending a session

Click the "End session" icon button in the header. Students can no longer check in. The session moves into the Sessions list as inactive.

### Viewing past sessions

Sessions tab lists all sessions grouped by Subject (Uncategorised first, then alphabetical by subject name). Each card shows date, attendance count, and:
- Click the card to open its attendance list
- "Activate" reactivates an inactive session (ends the current active one if there is one)
- The download icon exports the VUT-format CSV

## Student workflow

### Signing in

1. Open the student app on your phone. Tap "Sign in with VUT".

### Checking in

1. Point the camera at the QR code on the projector.
2. On success you will see a confirmation screen with your name and the session name, tap to close it or wait.

If the scan is rejected:
- "Invalid or expired QR code. Please scan the latest code." - the captured token is older than 2 seconds. Re-scan the current code on the projector
- "You have already checked in for this session." - you're already on the attendance list
- "Session has ended." - the teacher closed the session between scan and confirmation
- "No active session." - the teacher has not started a session yet

If the camera fails to start, tap "Start camera" and grant the browser camera permission.

## Admin notes

The `ADMIN_LOGINS` env var on the backend takes a comma-separated list of VUT logins. Anyone in that list:
- can sign into the teacher app regardless of employee affiliation

## CSV export format

Exports are UTF-8 CSV, semicolon separated, with a header row matching the VUT schema. They can be re-imported into CVIS as the attendance record for the lecture (only when the roster has been imported with the `dochazka-id-edit` column, as it has to match for the VUT system to accept it).
