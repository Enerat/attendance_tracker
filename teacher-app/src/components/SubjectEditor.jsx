import { useState, useEffect } from 'react';
import {
  getSubject,
  updateSubject,
  getSubjectStudents,
  replaceSubjectRoster,
} from '../services/api';
import StudentListUploadFields from './StudentListUploadFields';
import { useConfirm } from './ConfirmDialog';
import { useNotify } from './NotificationToast';
import { parseStudents } from '../utils/parseStudents';

function SubjectEditor({ subjectId, onClose }) {
  const confirm = useConfirm();
  const notify = useNotify();
  const [subject, setSubject] = useState(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [rosterText, setRosterText] = useState('');
  const [currentRoster, setCurrentRoster] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const found = await getSubject(subjectId);
        setSubject(found);
        setName(found.name);
        setCode(found.code || '');
        const roster = await getSubjectStudents(subjectId);
        setCurrentRoster(roster);
      } catch (err) {
        setError(err.message);
      }
    })();
  }, [subjectId]);

  const handleSave = async () => {
    if (saving || !name.trim()) return;
    setError('');

    let parsedRoster = null;
    if (rosterText.trim()) {
      parsedRoster = parseStudents(rosterText);
      if (parsedRoster.length === 0) {
        setError('No valid students in pasted roster.');
        return;
      }
      if (currentRoster.length > 0) {
        const ok = await confirm({
          title: 'Replace roster?',
          message: `Existing roster (${currentRoster.length} students) will be replaced with ${parsedRoster.length} new students.`,
          confirmLabel: 'Save and replace',
          tone: 'danger',
        });
        if (!ok) return;
      }
    }

    setSaving(true);
    try {
      await updateSubject(subjectId, { name: name.trim(), code: code.trim() || null });
      if (parsedRoster) {
        await replaceSubjectRoster(subjectId, parsedRoster);
        notify(`Subject saved (${parsedRoster.length} student${parsedRoster.length === 1 ? '' : 's'} in roster).`);
      } else {
        notify('Subject saved.');
      }
      onClose();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  if (!subject) {
    return (
      <div className="attendance-list">
        <div className="panel-loading">
          <div className="spinner"></div>
          <p>Loading subject...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="subject-editor attendance-list">
      <div className="list-header">
        <h2 className="heading-flush">Edit Subject</h2>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <section className="editor-section">
        <h3 className="section-title">Details</h3>
        <div className="form-group">
          <label htmlFor="subjectName">Name *</label>
          <input
            type="text"
            id="subjectName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="form-input"
            disabled={saving}
          />
        </div>
        <div className="form-group">
          <label htmlFor="subjectCode">Code (optional)</label>
          <input
            type="text"
            id="subjectCode"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="form-input"
            disabled={saving}
          />
        </div>
      </section>

      <section className="editor-section">
        <h3 className="section-title">
          Current Roster
          <span className="section-title-meta">({currentRoster.length})</span>
        </h3>
        {currentRoster.length === 0 ? (
          <p className="text-muted-hint">No students yet - paste a roster below.</p>
        ) : (
          <div className="roster-scroll">
            {currentRoster.map((s) => (
              <div key={s.student_id} className="roster-row">
                {s.student_name || s.student_id}
                {s.per_id && ` (${s.per_id})`}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="editor-section">
        <h3 className="section-title">Replace Roster <span className="section-title-meta">(optional)</span></h3>
        <p className="text-muted-hint">
          Paste a new list to replace the current roster. Leave empty to keep it.
          Existing sessions are not affected (their student list is a snapshot).
        </p>
        <StudentListUploadFields
          students={rosterText}
          onStudentsChange={setRosterText}
          disabled={saving}
        />
      </section>

      <div className="form-actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onClose}
          disabled={saving}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleSave}
          disabled={saving || !name.trim()}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}

export default SubjectEditor;
