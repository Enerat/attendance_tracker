// 0 = waiting, 1 = unexpected check-in, 2 = expected check-in
export function statusPriority(student) {
  if (!student.checked_in_at) return 0;
  if (!student.is_expected) return 1;
  return 2;
}

export function compareByStatus(a, b) {
  const pa = statusPriority(a);
  const pb = statusPriority(b);
  if (pa !== pb) return pa - pb;
  if (a.checked_in_at && b.checked_in_at) {
    return new Date(b.checked_in_at) - new Date(a.checked_in_at);
  }
  const nameA = a.student_name || a.student_id;
  const nameB = b.student_name || b.student_id;
  return nameA.localeCompare(nameB, 'cs');
}
