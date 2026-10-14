const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

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
  window.location.href = `${API_BASE_URL}/auth/login?role=student`;
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

export async function submitQRCheckIn(token) {
  const response = await fetch(`${API_BASE_URL}/checkin/qr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ token }),
  });

  if (!response.ok) {
    if (response.status === 409) {
      throw new Error('You have already checked in for this session');
    }
    const msg = await response.json().then(d => d.error).catch(() => null);
    throw new Error(msg || 'Check-in failed');
  }

  return response.json();
}
