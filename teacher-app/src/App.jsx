import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import SessionCreator from './components/SessionCreator';
import AttendanceList from './components/AttendanceList';
import SessionHistory from './components/SessionHistory';
import SubjectsPage from './components/SubjectsPage';
import QRPage from './components/QRPage';
import ErrorBoundary from './components/ErrorBoundary';
import { QrCode, CircleStop, Sun, Moon, LogOut, User } from 'lucide-react';
import { useConfirm } from './components/ConfirmDialog';
import { useNotify } from './components/NotificationToast';
import { getMe, loginWithSSO, logout, getActiveSession, getAllSessions, endSession, activateSession } from './services/api';
import { useSessionStudents } from './hooks/useSessionStudents';
import { SOCKET_URL, SOCKET_PATH } from './config';
import './App.css';

function getStoredTheme() {
  const stored = localStorage.getItem('theme');
  return stored === 'light' || stored === 'dark' ? stored : null;
}

function getSystemTheme() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function isQRPage() {
  return new URLSearchParams(window.location.search).has('qr');
}

function App() {
  if (isQRPage()) {
    return <QRPage />;
  }
  return <Dashboard />;
}

function ViewedSessionAttendance({ sessionId, sessionName }) {
  const { students, isLoading, refresh } = useSessionStudents(sessionId);
  return (
    <AttendanceList
      sessionId={sessionId}
      sessionName={sessionName}
      students={students}
      onRefresh={refresh}
      isLoading={isLoading}
    />
  );
}

function Dashboard() {
  const confirm = useConfirm();
  const notify = useNotify();
  const [user, setUser] = useState(null);
  const [authState, setAuthState] = useState('loading'); // 'loading' | 'unauthenticated' | 'authenticated'
  const [authError, setAuthError] = useState(null);

  const [activeSession, setActiveSession] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [viewedSessionId, setViewedSessionId] = useState(null);
  const [view, setView] = useState('active');
  const [sessionsLoading, setSessionsLoading] = useState(true);

  const [socket, setSocket] = useState(null);

  const { students: activeStudents, isLoading: activeStudentsLoading, refresh: refreshActiveStudents } =
    useSessionStudents(activeSession?.id, socket);

  const [theme, setTheme] = useState(() => getStoredTheme() ?? getSystemTheme());
  const [followSystem, setFollowSystem] = useState(() => getStoredTheme() === null);

  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);
  useEffect(() => {
    if (!userMenuOpen) return;
    const onPointer = (e) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setUserMenuOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setUserMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [userMenuOpen]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (!followSystem || !window.matchMedia) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e) => setTheme(e.matches ? 'dark' : 'light');
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, [followSystem]);

  const toggleTheme = () => {
    setTheme((t) => {
      const next = t === 'light' ? 'dark' : 'light';
      localStorage.setItem('theme', next);
      return next;
    });
    setFollowSystem(false);
  };

  useEffect(() => {
    const s = io(SOCKET_URL, {
      path: SOCKET_PATH,
      withCredentials: true,
    });
    setSocket(s);
    return () => {
      s.disconnect();
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get('auth_error');
    if (err) {
      const messages = {
        not_staff: 'Only VUT staff/faculty can access the teacher dashboard.',
        callback_failed: 'Login failed. Please try again.',
        session_missing: 'Session expired. Please try again.',
        sync_failed: 'Failed to sync teacher account. Contact administrator.',
      };
      setAuthError(messages[err] || 'Login failed. Please try again.');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    getMe()
      .then((userData) => {
        setUser(userData);
        setAuthState('authenticated');
      })
      .catch((err) => {
        setAuthState('unauthenticated');
        if (err.message !== 'Not authenticated') {
          setAuthError('Could not reach the server. Please try again later.');
        }
      });
  }, []);

  useEffect(() => {
    if (authState === 'authenticated') {
      loadActiveSession();
      loadSessions();
    }
  }, [authState]);

  const loadSessions = async () => {
    try {
      const data = await getAllSessions();
      setSessions(data);
    } catch {
      setSessions([]);
    } finally {
      setSessionsLoading(false);
    }
  };

  useEffect(() => {
    if (!socket) return;
    const onDisconnect = () => {
      notify('Connection lost - live updates paused. Reconnecting...');
    };
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('disconnect', onDisconnect);
    };
  }, [socket]);

  useEffect(() => {
    if (!socket) return;
    const handleCheckin = (data) => {
      if (data.checkin) notify(`${data.checkin.student_id} checked in.`);
    };
    socket.on('checkin', handleCheckin);
    return () => {
      socket.off('checkin', handleCheckin);
    };
  }, [socket]);

  const loadActiveSession = async () => {
    try {
      const session = await getActiveSession();
      setActiveSession(session);
    } catch {
      setActiveSession(null);
    }
  };

  const handleSessionCreated = async (newSession) => {
    if (newSession.is_active) {
      await loadActiveSession();
      setView('active');
    } else {
      setView('history');
    }
    loadSessions();
    const studentSuffix = newSession.studentCount ? ` with ${newSession.studentCount} students` : '';
    const message = newSession.is_active
      ? `Session created${studentSuffix}.`
      : `Session pre-created${studentSuffix}. Activate it from History when ready.`;
    notify(message);
  };

  const handleActivateSession = async (session) => {
    if (activeSession && session.id !== activeSession.id) {
      const ok = await confirm({
        title: 'Switch active session?',
        message: 'This will end the current active session.',
        confirmLabel: 'Switch',
        tone: 'danger',
      });
      if (!ok) return;
    }
    try {
      await activateSession(session.id);
      await loadActiveSession();
      await loadSessions();
      notify(`Activated "${session.session_name}".`);
    } catch (err) {
      notify(err.message || 'Failed to activate session.');
    }
  };

  const viewedSession = viewedSessionId
    ? sessions.find((s) => s.id === viewedSessionId) || null
    : null;

  // bounce back to history if the viewed session has disappeared from the list
  useEffect(() => {
    if (view === 'view-session' && viewedSessionId && !viewedSession && !sessionsLoading) {
      setViewedSessionId(null);
      setView('history');
    }
  }, [view, viewedSessionId, viewedSession, sessionsLoading]);

  const handleViewSession = (session) => {
    setViewedSessionId(session.id);
    setView('view-session');
  };

  const openQRWindow = () => {
    if (!activeSession) return;
    window.open(`${window.location.pathname}?qr`, 'QR Code', 'popup,width=600,height=700,menubar=no,toolbar=no,location=no,status=no');
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      // SSO redirect fail - clear local state anyway
    }
    setUser(null);
    setAuthState('unauthenticated');
    setActiveSession(null);
  };

  const handleEndSession = async () => {
    if (!activeSession) return;
    const ok = await confirm({
      title: 'End the current session?',
      message: 'Students will no longer be able to check in.',
      confirmLabel: 'End session',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await endSession(activeSession.id);
      setActiveSession(null);
      loadSessions();
      notify('Session ended.');
    } catch {
      notify('Failed to end session.');
    }
  };

  if (authState === 'loading') {
    return (
      <div className="app">
        <div className="loading-screen">
          <div className="spinner"></div>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  if (authState === 'unauthenticated') {
    return (
      <div className="app login-screen-app">
        <div className="login-screen">
          <div className="login-card">
            <div className="login-brand">Attendance</div>
            <p className="login-subtitle">Teacher Portal</p>
            <p className="login-description">
              Sign in with your VUT account to manage attendance sessions.
            </p>
            {authError && (
              <div className="alert alert-error login-error">
                {authError}
              </div>
            )}
            <button
              onClick={loginWithSSO}
              className="btn btn-primary login-cta"
            >
              Sign in with VUT
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-content">
          <div className={`header-brand ${activeSession ? '' : 'header-brand-empty'}`}>
            <span className="header-brand-name">
              {activeSession ? activeSession.session_name : 'Teacher Dashboard'}
            </span>
          </div>

          <nav className="header-tabs">
            <button
              className={`tab-link ${view === 'active' ? 'active' : ''}`}
              onClick={() => setView('active')}
            >
              Active
            </button>
            <button
              className={`tab-link ${view === 'history' || view === 'view-session' || view === 'new' ? 'active' : ''}`}
              onClick={() => { setViewedSessionId(null); setView('history'); }}
            >
              Sessions
            </button>
            <button
              className={`tab-link ${view === 'subjects' ? 'active' : ''}`}
              onClick={() => setView('subjects')}
            >
              Subjects
            </button>
          </nav>

          <div className="header-actions">
            {activeSession && (
              <>
                <button
                  className="icon-btn icon-btn-primary"
                  onClick={openQRWindow}
                  title="Open QR code"
                  aria-label="Open QR code"
                >
                  <QrCode size={20} />
                </button>
                <button
                  className="icon-btn"
                  onClick={handleEndSession}
                  title="End session"
                  aria-label="End session"
                >
                  <CircleStop size={20} />
                </button>
              </>
            )}
            <button
              className="icon-btn"
              onClick={toggleTheme}
              title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
              aria-label="Toggle theme"
            >
              {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
            </button>
            <div className="user-menu" ref={userMenuRef}>
              <button
                className="icon-btn"
                onClick={() => setUserMenuOpen((o) => !o)}
                title={user.name}
                aria-label="Account menu"
                aria-haspopup="true"
                aria-expanded={userMenuOpen}
              >
                <User size={20} />
              </button>
              {userMenuOpen && (
                <div className="user-menu-dropdown" role="menu">
                  <div className="user-menu-name">{user.name}</div>
                  <button
                    type="button"
                    role="menuitem"
                    className="user-menu-item"
                    onClick={() => { setUserMenuOpen(false); handleLogout(); }}
                  >
                    <LogOut size={20} />
                    Log out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="dashboard">
        <ErrorBoundary>
        {view === 'active' && (
          <div className="active-view">
            {!activeSession ? (
              <div className="empty-state attendance-list">
                <h2>No Active Session</h2>
                <button
                  onClick={() => setView('new')}
                  className="btn btn-primary btn-large create-session-action"
                >
                  Create New Session
                </button>
              </div>
            ) : (
              <div className="session-active">
                <AttendanceList
                  sessionId={activeSession.id}
                  sessionName={activeSession.session_name}
                  students={activeStudents}
                  onRefresh={refreshActiveStudents}
                  isLoading={activeStudentsLoading}
                />
              </div>
            )}
          </div>
        )}

        {view === 'new' && (
          <div className="new-session-view">
            <div className="new-session-container">
              <SessionCreator
                onSessionCreated={handleSessionCreated}
                onCancel={() => setView('history')}
                hasActiveSession={!!activeSession}
              />
            </div>
          </div>
        )}

        {view === 'history' && (
          <SessionHistory
            sessions={sessions}
            onViewSession={handleViewSession}
            onActivateSession={handleActivateSession}
            onNewSession={() => setView('new')}
            isLoading={sessionsLoading}
          />
        )}

        {view === 'subjects' && <SubjectsPage />}

        {view === 'view-session' && viewedSession && (
          <div className="session-active">
            <button
              onClick={() => setView('history')}
              className="btn btn-primary btn-small back-to-history"
            >
              Back to History
            </button>
            <ViewedSessionAttendance
              sessionId={viewedSession.id}
              sessionName={viewedSession.session_name}
            />
          </div>
        )}
        </ErrorBoundary>
      </div>
    </div>
  );
}

export default App;