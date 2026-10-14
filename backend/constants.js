const CHECKIN_METHOD = {
  QR: 'qr',
  MANUAL: 'manual',
};

const ROLE = {
  TEACHER: 'teacher',
  STUDENT: 'student',
};

const AFFILIATION = {
  STAFF: 'employee',
  STUDENT: 'student',
};

const STUDENT_AFFILIATIONS = ['student', 'czv', 'mba', 'll'];

const SOCKET_ROOM_PREFIX = 'session:';

module.exports = {
  CHECKIN_METHOD,
  ROLE,
  AFFILIATION,
  STUDENT_AFFILIATIONS,
  SOCKET_ROOM_PREFIX,
};
