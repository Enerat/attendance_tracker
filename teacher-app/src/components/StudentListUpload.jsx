import { useState } from 'react';
import { parseStudents } from '../utils/parseStudents';
import StudentListUploadFields from './StudentListUploadFields';
import { useNotify } from './NotificationToast';
import { addSessionStudents } from '../services/api';

function StudentListUpload({ sessionId, onUploadSuccess, onCancel }) {
  const notify = useNotify();
  const [students, setStudents] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsUploading(true);

    try {
      const parsedStudents = parseStudents(students);

      if (parsedStudents.length === 0) {
        throw new Error('No valid students found (need xlogin or per-id)');
      }

      await addSessionStudents(sessionId, parsedStudents);

      setStudents('');
      notify(`${parsedStudents.length} student${parsedStudents.length === 1 ? '' : 's'} added to roster.`);
      if (onUploadSuccess) {
        onUploadSuccess(parsedStudents.length);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleClose = () => {
    setError('');
    setStudents('');
    if (onCancel) onCancel();
  };

  return (
    <div className="student-list-upload attendance-list">
      <div className="list-header">
        <h2 className="heading-flush">Upload Student List</h2>
      </div>

      {error && (
        <div className="alert alert-error">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <section className="editor-section">
          <StudentListUploadFields
            students={students}
            onStudentsChange={setStudents}
            disabled={isUploading}
          />

          <div className="form-actions">
            <button
              type="button"
              onClick={handleClose}
              className="btn btn-secondary"
              disabled={isUploading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isUploading || !students.trim()}
            >
              {isUploading ? 'Uploading...' : 'Upload List'}
            </button>
          </div>
        </section>
      </form>
    </div>
  );
}

export default StudentListUpload;
