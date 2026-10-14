import { useState, useEffect, useRef } from 'react';
import QRScanner from './components/QRScanner';
import ErrorBoundary from './components/ErrorBoundary';
import { Sun, Moon, User, LogOut } from 'lucide-react';
import { getMe, loginWithSSO, logout, submitQRCheckIn } from './services/api';
import './App.css';

function getSystemTheme() {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

function getStoredTheme() {
  const stored = localStorage.getItem('theme');
  return stored === 'light' || stored === 'dark' ? stored : null;
}

function ThemeToggle({ theme, onToggle, className = '' }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`icon-btn ${className}`.trim()}
      title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
      aria-label="Toggle theme"
    >
      {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
    </button>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [authState, setAuthState] = useState('loading'); // 'loading' | 'unauthenticated' | 'authenticated'
  const [authError, setAuthError] = useState(null);

  const [checkInStatus, setCheckInStatus] = useState(null); // null | 'success' | 'error'
  const [statusMessage, setStatusMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [cameraAutoStart, setCameraAutoStart] = useState(true);
  const statusTimerRef = useRef(null);

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
    const params = new URLSearchParams(window.location.search);
    const err = params.get('auth_error');
    if (err) {
      const messages = {
        not_student: 'Your VUT account does not have student access.',
        callback_failed: 'Login failed. Please try again.',
        session_missing: 'Session expired. Please try again.',
      };
      setAuthError(messages[err] || 'Login failed. Please try again.');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    return () => { if (statusTimerRef.current) clearTimeout(statusTimerRef.current); };
  }, []);

  useEffect(() => {
    getMe()
      .then(userData => {
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

  const handleQRScanSuccess = async (token) => {
    setIsLoading(true);
    setCheckInStatus(null);

    try {
      const response = await submitQRCheckIn(token);
      setStatusMessage(`Check-in successful! Welcome to ${response.sessionName || 'class'}`);
      setCheckInStatus('success');

      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
      statusTimerRef.current = setTimeout(() => {
        setCheckInStatus(null);
        setStatusMessage('');
        setCameraAutoStart(false);
      }, 5000);
    } catch (error) {
      setCheckInStatus('error');
      setStatusMessage(error.message || 'Check-in failed. Please try again.');
      setCameraAutoStart(false);
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
      statusTimerRef.current = setTimeout(() => {
        setCheckInStatus(null);
        setStatusMessage('');
      }, 5000);
    } finally {
      setIsLoading(false);
    }
  };

  const handleQRScanError = (error) => {
    setStatusMessage(error.message);
    setCheckInStatus('error');
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    statusTimerRef.current = setTimeout(() => {
      setCheckInStatus(null);
      setStatusMessage('');
    }, 3000);
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      // SSO redirect may fail - clear local state anyway
    }
    setUser(null);
    setAuthState('unauthenticated');
    setCheckInStatus(null);
    setStatusMessage('');
  };

  if (authState === 'loading') {
    return (
      <div className="app fullscreen login-mode">
        <ThemeToggle theme={theme} onToggle={toggleTheme} className="theme-toggle-fixed" />
        <div className="login-screen">
          <div className="login-brand">Attendance</div>
          <p className="login-subtitle">Student Portal</p>
          <div className="login-loading">Loading...</div>
        </div>
      </div>
    );
  }

  if (authState === 'unauthenticated') {
    return (
      <div className="app fullscreen login-mode">
        <ThemeToggle theme={theme} onToggle={toggleTheme} className="theme-toggle-fixed" />
        <div className="login-screen">
          <div className="login-brand">Attendance</div>
          <p className="login-subtitle">Student Portal</p>
          <p className="login-description">
            Sign in with your VUT account to check in.
          </p>

          {authError && (
            <div className="alert alert-error login-error">
              {authError}
            </div>
          )}

          <button onClick={loginWithSSO} className="btn btn-primary login-cta">
            Sign in with VUT
          </button>
        </div>
      </div>
    );
  }

  const dismissSuccess = () => {
    setCheckInStatus(null);
    setStatusMessage('');
    setCameraAutoStart(false);
  };

  if (checkInStatus === 'success') {
    return (
      <div className="app fullscreen" onClick={dismissSuccess}>
        <div className="success-screen">
          <div className="success-animation">
            <div className="checkmark">&#x2713;</div>
            <p>Success!</p>
          </div>
          {statusMessage && (
            <div className="alert alert-success">
              {statusMessage}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="app fullscreen scanner-mode">
      <div className="scanner-screen">
        <div className="scanner-header">
          <div className="scanner-header-actions">
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
            <div className="user-menu" ref={userMenuRef}>
              <button
                className="icon-btn"
                onClick={() => setUserMenuOpen((o) => !o)}
                title={user.login}
                aria-label="Account menu"
                aria-haspopup="true"
                aria-expanded={userMenuOpen}
              >
                <User size={20} />
              </button>
              {userMenuOpen && (
                <div className="user-menu-dropdown" role="menu">
                  <div className="user-menu-name">{user.login}</div>
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

        <ErrorBoundary>
        {isLoading ? (
          <div className="qr-scanner-validating">
            <h3>Checking in...</h3>
          </div>
        ) : (
          <>
<QRScanner
              onScanSuccess={handleQRScanSuccess}
              onError={handleQRScanError}
              autoStart={cameraAutoStart}
            />
          </>
        )}
        </ErrorBoundary>

        {statusMessage && checkInStatus === 'error' && (
          <div className="scanner-error">
            <div className="alert alert-error">
              {statusMessage}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
