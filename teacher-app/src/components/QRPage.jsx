import { useState, useEffect, useCallback } from 'react';
import { io } from 'socket.io-client';
import QRCode from 'qrcode';
import { manualCheckin, generateQRToken, getActiveSession } from '../services/api';
import { useSessionStudents } from '../hooks/useSessionStudents';
import { useNotify } from './NotificationToast';
import { compareByStatus } from '../utils/studentSort';
import { SOCKET_URL, SOCKET_PATH } from '../config';
import './QRPage.css';

function QRPage() {
    const notify = useNotify();
    const [activeSession, setActiveSession] = useState(null);
    const [activeLoading, setActiveLoading] = useState(true);
    const [qrCodeUrl, setQrCodeUrl] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [sessionExpired, setSessionExpired] = useState(false);
    const [socket, setSocket] = useState(null);

    const loadActive = useCallback(async () => {
        try {
            const s = await getActiveSession();
            setActiveSession(s);
        } catch {
            setActiveSession(null);
        } finally {
            setActiveLoading(false);
        }
    }, []);

    useEffect(() => { loadActive(); }, [loadActive]);

    const sessionId = activeSession?.id;
    const { students } = useSessionStudents(sessionId, socket);

    useEffect(() => {
        const s = io(SOCKET_URL, {
            path: SOCKET_PATH,
            withCredentials: true,
        });
        setSocket(s);
        return () => s.disconnect();
    }, []);

    useEffect(() => {
        if (!sessionId || sessionExpired) return;
        let cancelled = false;

        const generateQR = async () => {
            try {
                const data = await generateQRToken(sessionId, 2 / 60);
                const qrUrl = await QRCode.toDataURL(data.qrData, {
                    width: 2048,
                    margin: 2,
                    color: { dark: '#000000', light: '#ffffff' }
                });
                setQrCodeUrl(qrUrl);
                setError(null);
                return 'ok';
            } catch (err) {
                if (err.message === 'Session expired') {
                    setSessionExpired(true);
                    return 'expired';
                }
                console.error('QR generation error:', err);
                setError('Failed to generate QR code');
                return 'error';
            } finally {
                setIsLoading(false);
            }
        };

        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

        const loop = async () => {
            let errorCount = 0;
            while (!cancelled) {
                const result = await generateQR();
                if (cancelled) break;
                if (result === 'expired') break;
                if (result === 'ok') {
                    errorCount = 0;
                    await sleep(500);
                } else {
                    errorCount++;
                    const delay = Math.min(1000 * Math.pow(2, errorCount - 1), 30000);
                    await sleep(delay);
                }
            }
        };
        loop();
        return () => { cancelled = true; };
    }, [sessionId, sessionExpired]);

    const handleManualCheckin = async (student) => {
        try {
            await manualCheckin(sessionId, student.student_id, student.per_id);
        } catch (err) {
            notify(err.message || 'Failed to check in student.');
        }
    };

    const checkedIn = students.filter(s => s.checked_in_at);
    const expected = students.filter(s => s.is_expected);

    if (sessionExpired) {
        return (
            <div className="qr-page">
                <div className="qr-page-expired">
                    <h1>Session Expired</h1>
                    <p>Your teacher session has expired. Please log in again in the main window and reopen the QR code.</p>
                    <button className="btn btn-primary" onClick={() => window.close()}>Close</button>
                </div>
            </div>
        );
    }

    if (activeLoading) {
        return (
            <div className="qr-page">
                <div className="qr-page-loading">
                    <div className="spinner"></div>
                </div>
            </div>
        );
    }

    if (!activeSession) {
        return (
            <div className="qr-page">
                <div className="qr-page-expired">
                    <h1>No Active Session</h1>
                    <button className="btn btn-primary" onClick={() => window.close()}>Close</button>
                </div>
            </div>
        );
    }

    const sortedStudents = [...students].sort(compareByStatus);

    return (
        <div className="qr-page">
            <div className="qr-page-layout">
                <div className="qr-page-left">
                    <div className="qr-display">
                        {isLoading && !qrCodeUrl ? (
                            <div className="qr-page-loading">
                                <div className="spinner"></div>
                            </div>
                        ) : error ? (
                            <div className="qr-page-error">
                                <p>{error}</p>
                            </div>
                        ) : (
                            <img src={qrCodeUrl} alt="QR Code" className="qr-page-image" />
                        )}
                    </div>
                </div>

                <div className="qr-page-right">
                    <ol className="qr-page-help">
                        <li>Open the student app (QR has the link)</li>
                        <li>Sign in with your VUT account</li>
                        <li>Point the camera at the QR code</li>
                    </ol>

                    <div className="qr-page-students">
                        <div className="qr-page-students-header">
                            <span className="qr-page-students-title">{activeSession.session_name}</span>
                            <span className="qr-page-students-count">
                                {checkedIn.length}{expected.length > 0 && ` / ${expected.length}`}
                            </span>
                        </div>

                        <div className="qr-page-students-list">
                            {sortedStudents.length === 0 ? (
                                <div className="qr-page-students-empty">No students yet</div>
                            ) : (
                                sortedStudents.map(student => {
                                    const statusClass = student.checked_in_at
                                        ? (student.is_expected ? 'checked-in' : 'unexpected')
                                        : 'waiting';
                                    const dotClass = student.checked_in_at
                                        ? (student.is_expected ? 'status-dot-present' : 'status-dot-unexpected')
                                        : 'status-dot-waiting';
                                    return (
                                        <div
                                            key={student.student_id}
                                            className={`qr-student-row ${statusClass}`}
                                            onClick={() => !student.checked_in_at && handleManualCheckin(student)}
                                        >
                                            <span className={`status-dot ${dotClass}`} />
                                            <span className="qr-student-number">{student.display_number}</span>
                                            <span className="qr-student-name">{student.student_name || student.student_id}</span>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default QRPage;
