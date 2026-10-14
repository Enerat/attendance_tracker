import { useCallback, useEffect, useRef, useState } from 'react';
import { getSessionStudents } from '../services/api';
import { applyCheckinUpdate } from '../utils/applyCheckinUpdate';

// pass socket=null for a read-only (historic) session, skips live updates
export function useSessionStudents(sessionId, socket = null) {
  const [students, setStudents] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  const refresh = useCallback(async () => {
    const id = sessionIdRef.current;
    if (!id) return;
    try {
      const data = await getSessionStudents(id);
      setStudents(data);
    } catch (err) {
      console.error('Failed to fetch students:', err);
    }
  }, []);

  useEffect(() => {
    if (!sessionId) {
      setStudents([]);
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    getSessionStudents(sessionId)
      .then((data) => {
        if (!cancelled) {
          setStudents(data);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        console.error('Failed to load students:', err);
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, [sessionId]);

  useEffect(() => {
    if (!socket || !sessionId) return;
    socket.emit('join-session', sessionId);
    const handleCheckin = (data) => {
      setStudents((prev) => applyCheckinUpdate(prev, data));
    };
    const handleReconnect = () => {
      socket.emit('join-session', sessionId);
      refresh();
    };
    socket.on('checkin', handleCheckin);
    socket.on('connect', handleReconnect);
    return () => {
      socket.emit('leave-session', sessionId);
      socket.off('checkin', handleCheckin);
      socket.off('connect', handleReconnect);
    };
  }, [socket, sessionId, refresh]);

  return { students, isLoading, refresh };
}
