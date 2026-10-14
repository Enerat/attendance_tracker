export function detectExtendedMode(text) {
  if (!text) return false;
  if (!text.includes(';') && !text.includes(',')) return false;
  const firstLine = text.split('\n')[0];
  return firstLine.split(/[;,]/).length > 1;
}

export function parseStudents(text) {
  const lines = text.split('\n').filter(line => line.trim());
  if (lines.length === 0) return [];

  if (!detectExtendedMode(text)) {
    return lines.flatMap(line =>
      line.split(/[,;]/)
        .map(id => id.trim().toLowerCase())
        .filter(id => id.length > 0)
        .map(id => /^\d{5,6}$/.test(id)
          ? { student_id: id, per_id: id }
          : { student_id: id })
    );
  }

  const delimiter = text.includes(';') ? ';' : ',';
  let dataLines = lines;
  let colIndex = { perId: 2, jmeno: 1, docId: 0 };

  const firstLine = lines[0].toLowerCase();
  if (firstLine.includes('xlogin') || firstLine.includes('login') ||
    firstLine.includes('student') || firstLine.includes('jmeno') ||
    firstLine.includes('per-id') || firstLine.includes('osobni') ||
    firstLine.includes('dochazka-id-edit')) {
    const headers = lines[0].split(delimiter).map(h => h.trim().toLowerCase());
    colIndex.perId = headers.indexOf('per-id');
    colIndex.jmeno = headers.indexOf('jmeno');
    colIndex.docId = headers.indexOf('dochazka-id-edit');

    if (colIndex.perId < 0) colIndex.perId = 2;
    if (colIndex.jmeno < 0) colIndex.jmeno = 1;
    if (colIndex.docId < 0) colIndex.docId = 0;
    dataLines = lines.slice(1);
  }

  return dataLines.map(line => {
    const parts = line.split(delimiter).map(p => p.trim());
    let studentId = null, perId = null, studentName = null, dochazkaId = null;

    if (colIndex.perId >= 0 && parts[colIndex.perId] && /^\d{5,6}$/.test(parts[colIndex.perId])) {
      perId = parts[colIndex.perId];
    }
    if (colIndex.jmeno >= 0 && parts[colIndex.jmeno]) {
      studentName = parts[colIndex.jmeno];
    }
    if (colIndex.docId >= 0 && parts[colIndex.docId]) {
      dochazkaId = parts[colIndex.docId];
      if (!perId) {
        const extracted = dochazkaId.split('_')[0];
        if (/^\d{5,6}$/.test(extracted)) perId = extracted;
      }
    }

    for (const part of parts) {
      if (/^x[a-z]{5,6}\d{2}$/i.test(part)) {
        studentId = part.toLowerCase();
        break;
      }
    }

    if (!studentId && perId) studentId = perId;
    if (!studentId && parts[0]) studentId = parts[0].toLowerCase();
    if (!perId && parts[1] && /^\d+$/.test(parts[1])) perId = parts[1];
    if (!studentName && parts[2]) studentName = parts[2];

    return { student_id: studentId, per_id: perId, student_name: studentName, dochazka_id: dochazkaId };
  }).filter(s => s.student_id);
}

export function readFileAsText(file, onLoad) {
  const reader = new FileReader();
  reader.onload = (event) => onLoad(event.target.result);
  reader.readAsText(file);
}
