const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

async function throwResponseError(response, fallback) {
  const msg = await response.json().then(d => d.error).catch(() => null);
  throw new Error(msg || fallback);
}

export async function getMe() {
  const response = await fetch(`${API_BASE_URL}/auth/me`, {
    credentials: 'include',
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error('Not authenticated');
    throw new Error('Server error');
  }
  return response.json();
}

export function loginWithSSO() {
  window.location.href = `${API_BASE_URL}/auth/login?role=teacher`;
}

export async function logout() {
  try {
    const response = await fetch(`${API_BASE_URL}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!response.ok) return;
    const data = await response.json();
    if (data.ssoLogoutUrl) {
      window.location.href = data.ssoLogoutUrl;
    }
  } catch {
    // local session state will be cleared by the caller
  }
}

// isActive=false pre-creates the session without activating it
export async function createSession(sessionName, subjectId = null, isActive = true) {
  const response = await fetch(`${API_BASE_URL}/session/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ sessionName, subjectId, isActive }),
  });
  if (!response.ok) await throwResponseError(response, 'Failed to create session');
  return response.json();
}

export async function endSession(sessionId) {
  const response = await fetch(`${API_BASE_URL}/session/${sessionId}/end`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) await throwResponseError(response, 'Failed to end session');
  return response.json();
}

// deactivates any other active session owned by this teacher
export async function activateSession(sessionId) {
  const response = await fetch(`${API_BASE_URL}/session/${sessionId}/activate`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) await throwResponseError(response, 'Failed to activate session');
  return response.json();
}

export async function getActiveSession() {
  const response = await fetch(`${API_BASE_URL}/session/active`, {
    credentials: 'include',
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error('No active session');
    throw new Error('Failed to fetch active session');
  }
  return response.json();
}

export async function getAllSessions() {
  const response = await fetch(`${API_BASE_URL}/sessions`, {
    credentials: 'include',
  });
  if (!response.ok) throw new Error('Failed to fetch sessions');
  return response.json();
}

export async function listSubjects(includeArchived = false) {
  const url = `${API_BASE_URL}/subjects${includeArchived ? '?includeArchived=1' : ''}`;
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) throw new Error('Failed to fetch subjects');
  return response.json();
}

export async function getSubject(id) {
  const response = await fetch(`${API_BASE_URL}/subjects/${id}`, {
    credentials: 'include',
  });
  if (!response.ok) throw new Error('Failed to fetch subject');
  return response.json();
}

export async function createSubject(name, code = null) {
  const response = await fetch(`${API_BASE_URL}/subjects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ name, code }),
  });
  if (!response.ok) await throwResponseError(response, 'Failed to create subject');
  return response.json();
}

export async function updateSubject(id, fields) {
  const response = await fetch(`${API_BASE_URL}/subjects/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(fields),
  });
  if (!response.ok) await throwResponseError(response, 'Failed to update subject');
  return response.json();
}

export async function archiveSubject(id) {
  const response = await fetch(`${API_BASE_URL}/subjects/${id}/archive`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) throw new Error('Failed to archive subject');
  return response.json();
}

export async function unarchiveSubject(id) {
  const response = await fetch(`${API_BASE_URL}/subjects/${id}/unarchive`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) throw new Error('Failed to unarchive subject');
  return response.json();
}

export async function getSubjectStudents(id) {
  const response = await fetch(`${API_BASE_URL}/subjects/${id}/students`, {
    credentials: 'include',
  });
  if (!response.ok) throw new Error('Failed to fetch subject roster');
  return response.json();
}

export async function replaceSubjectRoster(id, students) {
  const response = await fetch(`${API_BASE_URL}/subjects/${id}/students`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ students }),
  });
  if (!response.ok) await throwResponseError(response, 'Failed to save roster');
  return response.json();
}

export async function getSessionStudents(sessionId) {
  const response = await fetch(`${API_BASE_URL}/session/${sessionId}/students`, {
    credentials: 'include',
  });
  if (!response.ok) throw new Error('Failed to fetch students');
  return response.json();
}

export async function addSessionStudents(sessionId, students) {
  const response = await fetch(`${API_BASE_URL}/session/${sessionId}/students`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ students }),
  });
  if (!response.ok) await throwResponseError(response, 'Failed to add students');
  return response.json();
}

export async function manualCheckin(sessionId, student_id, per_id) {
  const response = await fetch(`${API_BASE_URL}/session/${sessionId}/manual-checkin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ student_id, per_id }),
  });
  if (!response.ok) await throwResponseError(response, 'Failed to check in student');
  return response.json();
}

export async function deleteCheckin(sessionId, student_id) {
  const response = await fetch(`${API_BASE_URL}/session/${sessionId}/checkin`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ student_id }),
  });
  if (!response.ok) await throwResponseError(response, 'Failed to remove check-in');
  return response.json();
}

export async function exportSession(sessionId, format = 'vut') {
  const response = await fetch(`${API_BASE_URL}/session/${sessionId}/export?format=${format}`, {
    credentials: 'include',
  });
  if (!response.ok) throw new Error('Failed to export');
  return response.blob();
}

export async function generateQRToken(sessionId, validityMinutes) {
  const response = await fetch(`${API_BASE_URL}/session/${sessionId}/qr-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ validityMinutes }),
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 410) throw new Error('Session expired');
    throw new Error('Failed to generate QR token');
  }
  return response.json();
}
