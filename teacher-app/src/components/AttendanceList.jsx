import { useState } from 'react';
import StudentListUpload from './StudentListUpload';
import { Check, X, Download, Upload, Search } from 'lucide-react';
import { useConfirm } from './ConfirmDialog';
import { useNotify } from './NotificationToast';
import { deleteCheckin, manualCheckin, exportSession } from '../services/api';
import { statusPriority } from '../utils/studentSort';

function AttendanceList({ sessionId, sessionName, students = [], onRefresh, isLoading = false }) {
  const confirm = useConfirm();
  const notify = useNotify();
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('status');
  const [showUploadForm, setShowUploadForm] = useState(false);

  const handleUncheck = async (student) => {
    const label = student.student_name || student.student_id;
    const ok = await confirm({
      title: 'Remove check-in?',
      message: `${label} will be marked as not checked in.`,
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await deleteCheckin(sessionId, student.student_id);
    } catch (error) {
      notify(error.message || 'Failed to remove check-in.');
    }
  };

  const handleManualCheckin = async (student) => {
    try {
      await manualCheckin(sessionId, student.student_id, student.per_id);
    } catch (error) {
      notify(error.message || 'Failed to check in student.');
    }
  };

  const handleExport = async () => {
    try {
      const blob = await exportSession(sessionId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `attendance_${sessionName}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      notify(error.message || 'Failed to export.');
    }
  };

  const handleUploadSuccess = () => {
    setShowUploadForm(false);
    if (onRefresh) onRefresh();
  };

  const filteredStudents = students.filter(student => {
    const searchLower = searchTerm.toLowerCase();
    return (
      student.student_id.toLowerCase().includes(searchLower) ||
      (student.per_id && student.per_id.includes(searchLower)) ||
      (student.student_name && student.student_name.toLowerCase().includes(searchLower))
    );
  });

  const sortedStudents = [...filteredStudents].sort((a, b) => {
    if (sortBy === 'status') {
      const priorityA = statusPriority(a);
      const priorityB = statusPriority(b);

      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }

      if (a.checked_in_at && b.checked_in_at) {
        return new Date(b.checked_in_at) - new Date(a.checked_in_at);
      }
      const nameA = a.student_name || a.student_id;
      const nameB = b.student_name || b.student_id;
      return nameA.localeCompare(nameB, 'cs');
    } else if (sortBy === 'id') {
      return a.student_id.localeCompare(b.student_id);
    } else if (sortBy === 'name') {
      const nameA = a.student_name || a.student_id;
      const nameB = b.student_name || b.student_id;
      return nameA.localeCompare(nameB, 'cs');
    } else {
      if (!a.checked_in_at) return 1;
      if (!b.checked_in_at) return -1;
      return new Date(b.checked_in_at) - new Date(a.checked_in_at);
    }
  });

  const formatTime = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleTimeString('cs-CZ', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: 'Europe/Prague'
    });
  };

  const getRowClassName = (student) => {
    if (!student.checked_in_at) return 'student-row student-not-checked';
    if (student.is_expected) return 'student-row student-expected';
    return 'student-row student-unexpected';
  };

  const getStatusLabel = (student) => {
    if (!student.checked_in_at) return 'Waiting';
    if (student.is_expected) return 'Present';
    return 'Unexpected';
  };

  const hasExtendedData = students.some(s => s.per_id || s.student_name);
  const hasLoginCol = students.some(s => s.student_id !== s.per_id);
  const checkedInCount = students.filter(s => s.checked_in_at).length;
  const expectedCount = students.filter(s => s.is_expected).length;
  const unexpectedCount = students.filter(s => s.checked_in_at && !s.is_expected).length;

  if (showUploadForm) {
    return (
      <StudentListUpload
        sessionId={sessionId}
        onUploadSuccess={handleUploadSuccess}
        onCancel={() => setShowUploadForm(false)}
      />
    );
  }

  if (isLoading && students.length === 0) {
    return (
      <div className="attendance-list">
        <div className="panel-loading">
          <div className="spinner"></div>
          <p>Loading attendance...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="attendance-list">
      <div className="list-header">
        <div className="list-stats">
          <div className="stat-item">
            <span className="stat-value">{expectedCount}</span>
            <span className="stat-label">Expected</span>
          </div>
          <div className="stat-item">
            <span className="stat-value stat-success">{checkedInCount}</span>
            <span className="stat-label">Present</span>
          </div>
          {unexpectedCount > 0 && (
            <div className="stat-item">
              <span className="stat-value stat-warning">{unexpectedCount}</span>
              <span className="stat-label">Unexpected</span>
            </div>
          )}
        </div>

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

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="sort-select"
          >
            <option value="status">Status</option>
            <option value="time">Time</option>
            <option value="id">Login</option>
            {hasExtendedData && <option value="name">Name</option>}
          </select>

          <button
            onClick={() => setShowUploadForm(true)}
            className="btn btn-secondary btn-small"
          >
            <Upload size={18} />
            Upload
          </button>

          <button
            onClick={handleExport}
            className="btn btn-secondary btn-small"
            disabled={students.length === 0}
          >
            <Download size={18} />
            Download
          </button>
        </div>
      </div>

      {sortedStudents.length === 0 ? (
        <div className="empty-state">
          {searchTerm ? (
            <p>No students found matching "{searchTerm}"</p>
          ) : (
            <p>No students yet</p>
          )}
        </div>
      ) : (
        <div className="table-container">
          <table className="attendance-table">
            <thead>
              <tr>
                <th>#</th>
                {hasExtendedData && <th>Name</th>}
                {hasLoginCol && <th>Login</th>}
                {hasExtendedData && <th>ID</th>}
                <th>Status</th>
                <th>Check-in Time</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sortedStudents.map((student) => (
                <tr key={student.student_id} className={getRowClassName(student)}>
                  <td>{student.display_number}</td>
                  {hasExtendedData && (
                    <td className="student-name">{student.student_name || ''}</td>
                  )}
                  {hasLoginCol && (
                    <td className="student-id">{student.student_id !== student.per_id ? student.student_id : ''}</td>
                  )}
                  {hasExtendedData && (
                    <td className="per-id">{student.per_id || ''}</td>
                  )}
                  <td className="status-cell">{getStatusLabel(student)}</td>
                  <td className="time-col">{formatTime(student.checked_in_at)}</td>
                  <td className="action-col">
                    {!student.checked_in_at ? (
                      <button
                        onClick={() => handleManualCheckin(student)}
                        className="row-action row-action-checkin"
                        title="Manual check-in"
                        aria-label="Manual check-in"
                      >
                        <Check size={18} strokeWidth={2.5} />
                      </button>
                    ) : (
                      <button
                        onClick={() => handleUncheck(student)}
                        className="row-action row-action-uncheck"
                        title="Remove check-in"
                        aria-label="Remove check-in"
                      >
                        <X size={18} strokeWidth={2.5} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="list-footer">
        <div className="legend">
          <span className="legend-item"><span className="status-dot status-dot-waiting" />Not checked in</span>
          <span className="legend-item"><span className="status-dot status-dot-present" />Present (expected)</span>
          <span className="legend-item"><span className="status-dot status-dot-unexpected" />Present (unexpected)</span>
        </div>
        <p>Showing {filteredStudents.length} of {students.length} students</p>
      </div>
    </div>
  );
}

export default AttendanceList;
