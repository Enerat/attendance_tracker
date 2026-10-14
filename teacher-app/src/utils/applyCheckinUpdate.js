export function applyCheckinUpdate(students, data) {
  if (data.removed) {
    return students.flatMap((s) => {
      if (s.student_id !== data.removed.student_id) return [s];
      if (!s.is_expected) return [];
      return [{ ...s, checkin_id: null, checked_in_at: null, checkin_method: null, rssi: null }];
    });
  }

  if (data.checkin) {
    const idx = students.findIndex(
      (s) => s.student_id === data.checkin.student_id
        || (s.per_id && data.checkin.per_id && s.per_id === data.checkin.per_id)
    );
    if (idx >= 0) {
      const updated = [...students];
      updated[idx] = {
        ...updated[idx],
        checkin_id: data.checkin.id,
        checked_in_at: data.checkin.checked_in_at,
        checkin_method: data.checkin.checkin_method,
        rssi: data.checkin.rssi,
        per_id: updated[idx].per_id || data.checkin.per_id,
      };
      return updated;
    }
    const nextNumber = students.reduce((m, s) => Math.max(m, s.display_number || 0), 0) + 1;
    return [...students, {
      student_id: data.checkin.student_id,
      per_id: data.checkin.per_id || null,
      student_name: null,
      checkin_id: data.checkin.id,
      checked_in_at: data.checkin.checked_in_at,
      checkin_method: data.checkin.checkin_method,
      rssi: data.checkin.rssi,
      is_expected: 0,
      display_number: nextNumber,
    }];
  }

  return students;
}
