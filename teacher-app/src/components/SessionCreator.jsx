import { useState, useEffect } from 'react';
import { createSession, listSubjects, addSessionStudents } from '../services/api';
import { parseStudents } from '../utils/parseStudents';
import StudentListUploadFields from './StudentListUploadFields';
import { useConfirm } from './ConfirmDialog';

function todayIso() {
  return new Date().toISOString().split('T')[0];
}

function SessionCreator({ onSessionCreated, onCancel, hasActiveSession = false }) {
  const confirm = useConfirm();
  const [sessionName, setSessionName] = useState('');
  const [students, setStudents] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [subjects, setSubjects] = useState([]);
  const [subjectId, setSubjectId] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [startNow, setStartNow] = useState(true);

  useEffect(() => {
    listSubjects(false).then(setSubjects).catch(() => setSubjects([]));
  }, []);

  const handleSubjectChange = (e) => {
    const value = e.target.value;
    setSubjectId(value);
    if (value && !nameTouched) {
      const subject = subjects.find((s) => String(s.id) === value);
      if (subject) setSessionName(`${subject.name} - ${todayIso()}`);
    }
  };

  const handleNameChange = (e) => {
    setSessionName(e.target.value);
    setNameTouched(true);
  };

  const uploadStudentList = (sessionId, studentList) => addSessionStudents(sessionId, studentList);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!sessionName.trim()) {
      setError('Enter a session name');
      return;
    }

    if (startNow && hasActiveSession) {
      const ok = await confirm({
        title: 'Switch active session?',
        message: 'Creating and starting this session will end the current active session.',
        confirmLabel: 'Create and switch',
        tone: 'danger',
      });
      if (!ok) return;
    }

    setIsLoading(true);

    try {
      const chosenSubjectId = subjectId ? parseInt(subjectId) : null;
      const response = await createSession(sessionName.trim(), chosenSubjectId, startNow);
      const sessionId = response.sessionId;

      let studentCount = 0;
      // Manual upload is only used in the no-subject path.
      if (!chosenSubjectId && students.trim()) {
        const parsedStudents = parseStudents(students);

        if (parsedStudents.length > 0) {
          await uploadStudentList(sessionId, parsedStudents);
          studentCount = parsedStudents.length;
        }
      }

      setSessionName('');
      setStudents('');
      setSubjectId('');
      setNameTouched(false);

      onSessionCreated({
        id: sessionId,
        session_name: sessionName,
        created_at: new Date().toISOString(),
        is_active: startNow ? 1 : 0,
        studentCount,
      });
    } catch (err) {
      setError(err.message || 'Failed to create session');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    if (onCancel) onCancel();
  };

  return (
    <div className="session-creator attendance-list">
      <div className="list-header">
        <h2 className="heading-flush">New Session</h2>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <form onSubmit={handleSubmit}>
        <section className="editor-section">
          <h3 className="section-title">Details</h3>
          <div className="form-group">
            <label htmlFor="sessionName">Session Name *</label>
            <input
              type="text"
              id="sessionName"
              value={sessionName}
              onChange={handleNameChange}
              placeholder="IIS - 24-4-2026"
              className="form-input"
              disabled={isLoading}
              autoFocus
            />
          </div>

          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={startNow}
                onChange={(e) => setStartNow(e.target.checked)}
                disabled={isLoading}
              />
              Start now
            </label>
          </div>

          {subjects.length > 0 && (
            <div className="form-group">
              <label htmlFor="subjectSelect">Subject</label>
              <select
                id="subjectSelect"
                value={subjectId}
                onChange={handleSubjectChange}
                className="form-input"
                disabled={isLoading}
              >
                <option value="">None (manual roster)</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}{s.code ? ` (${s.code})` : ''} - {s.student_count || 0} students
                  </option>
                ))}
              </select>
              <small className="form-help">
                Picking a subject auto-fills the session name and student list.
              </small>
            </div>
          )}
        </section>

        {!subjectId && (
          <section className="editor-section">
            <h3 className="section-title">Student Roster</h3>
            <StudentListUploadFields
              students={students}
              onStudentsChange={setStudents}
              disabled={isLoading}
            />
          </section>
        )}

        <div className="form-actions">
          <button
            type="button"
            onClick={handleCancel}
            className="btn btn-secondary"
            disabled={isLoading}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={isLoading || !sessionName.trim()}
          >
            {isLoading ? 'Creating...' : (startNow ? 'Create & Start' : 'Create')}
          </button>
        </div>
      </form>
    </div>
  );
}

export default SessionCreator;