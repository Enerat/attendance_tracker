import { useMemo } from 'react';
import { detectExtendedMode, parseStudents, readFileAsText } from '../utils/parseStudents';

function StudentListUploadFields({ students, onStudentsChange, disabled }) {
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    readFileAsText(file, (content) => onStudentsChange(content));
  };

  const detection = useMemo(() => {
    const trimmed = students.trim();
    if (!trimmed) return null;
    const count = parseStudents(students).length;
    const format = detectExtendedMode(students) ? 'VUT format' : 'plain xlogins / per-ids';
    return { count, format };
  }, [students]);

  return (
    <>
      <div className="form-group">
        <label htmlFor="studentFile">Upload File</label>
        <input
          type="file"
          id="studentFile"
          accept=".csv,.txt"
          onChange={handleFileUpload}
          className="file-input"
          disabled={disabled}
        />
        <small className="form-help">
          CSV / TXT - VUT export with header, one "per-id;name" per line, or one xlogin / per-id per line
        </small>
      </div>

      <div className="divider">OR</div>

      <div className="form-group">
        <label htmlFor="studentPaste">Paste Student Data</label>
        <textarea
          id="studentPaste"
          value={students}
          onChange={(e) => onStudentsChange(e.target.value)}
          placeholder={"VUT export with header:\ndochazka-id-edit;jmeno;per-id;...\n\nor one \"per-id;name\" per line:\n123456;Jan Novak\n\nor one xlogin / per-id per line:\nxnovak01\n234567"}
          rows="6"
          className="form-textarea"
          disabled={disabled}
        />
        {detection && (
          <small className={`form-help ${detection.count === 0 ? 'form-help-warning' : ''}`}>
            {detection.count === 0
              ? 'No valid students detected - check format'
              : `${detection.count} student${detection.count === 1 ? '' : 's'} detected (${detection.format})`}
          </small>
        )}
      </div>
    </>
  );
}

export default StudentListUploadFields;
