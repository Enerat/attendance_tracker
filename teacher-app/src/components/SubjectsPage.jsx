import { useState, useEffect, useMemo } from 'react';
import {
  listSubjects,
  createSubject,
  archiveSubject,
  unarchiveSubject,
} from '../services/api';
import SubjectEditor from './SubjectEditor';
import { Plus, Pencil, Archive, ArchiveRestore, Search } from 'lucide-react';
import { useConfirm } from './ConfirmDialog';

function SubjectsPage() {
  const confirm = useConfirm();
  const [subjects, setSubjects] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCode, setNewCode] = useState('');
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const filteredSubjects = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return subjects;
    return subjects.filter((s) =>
      s.name.toLowerCase().includes(q) ||
      (s.code && s.code.toLowerCase().includes(q))
    );
  }, [subjects, searchTerm]);

  const load = async () => {
    try {
      const data = await listSubjects(includeArchived);
      setSubjects(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, [includeArchived]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setError('');
    if (!newName.trim() || isCreating) return;
    setIsCreating(true);
    try {
      const { id } = await createSubject(newName.trim(), newCode.trim() || null);
      setNewName('');
      setNewCode('');
      setCreating(false);
      await load();
      setEditingId(id);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsCreating(false);
    }
  };

  const handleArchive = async (subject) => {
    const ok = await confirm({
      title: 'Archive subject?',
      message: `"${subject.name}" will be hidden from the active list.`,
      confirmLabel: 'Archive',
    });
    if (!ok) return;
    try {
      await archiveSubject(subject.id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleUnarchive = async (subject) => {
    try {
      await unarchiveSubject(subject.id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  if (editingId) {
    return (
      <SubjectEditor
        subjectId={editingId}
        onClose={() => { setEditingId(null); load(); }}
      />
    );
  }

  if (creating) {
    const cancelCreate = () => { setCreating(false); setNewName(''); setNewCode(''); setError(''); };
    return (
      <div className="subject-editor attendance-list">
        <div className="list-header">
          <h2 className="heading-flush">New Subject</h2>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleCreate}>
          <section className="editor-section">
            <h3 className="section-title">Details</h3>
            <div className="form-group">
              <label htmlFor="newSubjectName">Subject Name *</label>
              <input
                type="text"
                id="newSubjectName"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Information Systems"
                className="form-input"
                disabled={isCreating}
                autoFocus
              />
            </div>
            <div className="form-group">
              <label htmlFor="newSubjectCode">Code (optional)</label>
              <input
                type="text"
                id="newSubjectCode"
                value={newCode}
                onChange={(e) => setNewCode(e.target.value)}
                placeholder="IIS"
                className="form-input"
                disabled={isCreating}
              />
            </div>
            <div className="form-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={cancelCreate}
                disabled={isCreating}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={isCreating || !newName.trim()}
              >
                {isCreating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </section>
        </form>
      </div>
    );
  }

  return (
    <div className="subjects-page attendance-list">
      <div className="list-header">
        <h2 className="heading-flush">Subjects</h2>
        <div className="list-controls">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
            />
            Show archived
          </label>
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
          <button className="btn btn-primary btn-small" onClick={() => setCreating(true)}>
            <Plus size={14} />
            New Subject
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {isLoading && subjects.length === 0 ? (
        <div className="panel-loading">
          <div className="spinner"></div>
          <p>Loading subjects...</p>
        </div>
      ) : filteredSubjects.length === 0 ? (
        <div className="empty-state">
          {searchTerm ? (
            <p>No subjects found matching "{searchTerm}"</p>
          ) : (
            <p>No subjects yet</p>
          )}
        </div>
      ) : (
        <div className="sessions-grid">
          {filteredSubjects.map((s) => (
            <div
              key={s.id}
              className={`session-card ${s.archived_at ? 'archived' : ''}`}
              onClick={() => setEditingId(s.id)}
            >
              <div className="session-card-header">
                <h3>{s.name}{s.code ? ` (${s.code})` : ''}</h3>
                {s.archived_at && <span className="badge badge-muted">Archived</span>}
              </div>
              <div className="session-card-body">
                <div className="session-detail">
                  <span className="detail-label">Students</span>
                  <span>{s.student_count || 0}</span>
                </div>
              </div>
              <div className="session-card-footer">
                <button
                  className="btn btn-secondary btn-small"
                  onClick={(e) => { e.stopPropagation(); setEditingId(s.id); }}
                >
                  <Pencil size={14} />
                  Edit
                </button>
                {s.archived_at ? (
                  <button
                    className="btn btn-secondary btn-small"
                    onClick={(e) => { e.stopPropagation(); handleUnarchive(s); }}
                    title="Unarchive"
                  >
                    <ArchiveRestore size={14} />
                  </button>
                ) : (
                  <button
                    className="btn btn-secondary btn-small"
                    onClick={(e) => { e.stopPropagation(); handleArchive(s); }}
                    title="Archive"
                  >
                    <Archive size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default SubjectsPage;
