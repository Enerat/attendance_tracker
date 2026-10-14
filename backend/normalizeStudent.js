function normalizeStudent(s) {
  if (typeof s === 'string') {
    return { student_id: s.trim().toLowerCase(), per_id: null, student_name: null, dochazka_id: null };
  }
  const perId = s.per_id || s.osobni_cislo || null;
  const rawId = (s.student_id || s.xlogin || '').trim().toLowerCase();
  const studentId = rawId || (perId ? perId : '');
  return {
    student_id: studentId,
    per_id: perId,
    student_name: s.student_name || s.jmeno || null,
    dochazka_id: s.dochazka_id || null,
  };
}

module.exports = { normalizeStudent };
