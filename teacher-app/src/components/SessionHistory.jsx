import { useState, useMemo } from 'react';
import { Search, Download, Play, ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { exportSession } from '../services/api';

function SessionHistory({ sessions, onViewSession, onActivateSession, onNewSession, isLoading = false }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [collapsed, setCollapsed] = useState({});

  const filteredSessions = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((session) =>
      session.session_name.toLowerCase().includes(q) ||
      (session.subject_name && session.subject_name.toLowerCase().includes(q)) ||
      (session.subject_code && session.subject_code.toLowerCase().includes(q))
    );
  }, [sessions, searchTerm]);

  const orderedGroups = useMemo(() => {
    const groups = new Map();
    for (const s of filteredSessions) {
      const key = s.subject_id ? `subject:${s.subject_id}` : 'none';
      const label = s.subject_name
        ? `${s.subject_name}${s.subject_code ? ` (${s.subject_code})` : ''}`
        : 'Uncategorised';
      if (!groups.has(key)) groups.set(key, { key, label, sessions: [] });
      groups.get(key).sessions.push(s);
    }
    return [...groups.values()].sort((a, b) => {
      if (a.key === 'none') return -1;
      if (b.key === 'none') return 1;
      return a.label.localeCompare(b.label, 'cs');
    });
  }, [filteredSessions]);

  const toggle = (key) => setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));

  const formatDate = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleString('cs-CZ', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Prague'
    });
  };

  const handleExport = async (sessionId, sessionName, e) => {
    e.stopPropagation();
    try {
      const blob = await exportSession(sessionId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `attendance_${sessionName}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export error:', error);
    }
  };

  return (
    <div className="session-history">
      <div className="list-header">
        <h2 className="heading-flush">Sessions</h2>
        <div className="list-controls">
          <div className="search-wrapper">
            <Search size={16} />
            <input
              type="text"
              placeholder="Search..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
          </div>
          {onNewSession && (
            <button className="btn btn-primary btn-small" onClick={onNewSession}>
              <Plus size={14} />
              New Session
            </button>
          )}
        </div>
      </div>

      {isLoading && sessions.length === 0 ? (
        <div className="panel-loading">
          <div className="spinner"></div>
          <p>Loading sessions...</p>
        </div>
      ) : filteredSessions.length === 0 ? (
        <div className="empty-state">
          {searchTerm ? (
            <p>No sessions or subjects found matching "{searchTerm}"</p>
          ) : (
            <p>No sessions yet</p>
          )}
        </div>
      ) : (
        orderedGroups.map((group) => (
          <div key={group.key} className="history-group">
            <div
              onClick={() => toggle(group.key)}
              className="group-toggle"
            >
              <span className="group-toggle-label">
                {collapsed[group.key] ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                {group.label}
              </span>
              <span className="group-session-count">
                {group.sessions.length} session{group.sessions.length === 1 ? '' : 's'}
              </span>
            </div>
            {!collapsed[group.key] && (
              <div className="sessions-grid">
                {group.sessions.map((session) => (
                  <div
                    key={session.id}
                    className={`session-card ${session.is_active === 1 ? 'active' : ''}`}
                    onClick={() => onViewSession(session)}
                  >
                    <div className="session-card-header">
                      <h3>{session.session_name}</h3>
                      {session.is_active === 1 && (
                        <span className="badge badge-success">Active</span>
                      )}
                    </div>

                    <div className="session-card-body">
                      <div className="session-detail">
                        <span className="detail-label">Date:</span>
                        <span>{formatDate(session.created_at)}</span>
                      </div>

                      <div className="session-detail">
                        <span className="detail-label">Attendance:</span>
                        <span className="attendance-count">{session.checkin_count || 0} students</span>
                      </div>
                    </div>

                    <div className="session-card-footer">
                      {session.is_active !== 1 && onActivateSession && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onActivateSession(session);
                          }}
                          className="btn btn-secondary btn-small btn-activate"
                        >
                          <Play size={14} />
                          Activate
                        </button>
                      )}
                      <button
                        onClick={(e) => handleExport(session.id, session.session_name, e)}
                        className="btn btn-secondary btn-small"
                        disabled={!session.checkin_count || session.checkin_count === 0}
                        title="Export CSV"
                        aria-label="Export CSV"
                      >
                        <Download size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))
      )}

    </div>
  );
}

export default SessionHistory;