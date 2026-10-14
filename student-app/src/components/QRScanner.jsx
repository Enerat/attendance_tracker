import { useState, useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

function QRScanner({ onScanSuccess, onError, autoStart = false }) {
  const [isScanning, setIsScanning] = useState(false);
  const [hasCamera, setHasCamera] = useState(true);
  const [zoomCapability, setZoomCapability] = useState(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const scannerRef = useRef(null);
  const trackRef = useRef(null);
  const hasStarted = useRef(false);
  const isStopping = useRef(false);

  useEffect(() => {
    if (autoStart && !hasStarted.current) {
      hasStarted.current = true;
      startScanner();
    }

    return () => {
      stopScanner();
    };
  }, [autoStart]);

  const startScanner = async () => {
    try {
      const devices = await Html5Qrcode.getCameras();
      if (devices && devices.length > 0) {
        setHasCamera(true);
        setIsScanning(true);

        setTimeout(() => {
          initializeScanner();
        }, 100);
      } else {
        setHasCamera(false);
        onError(new Error('No camera found on this device.'));
      }
    } catch (err) {
      console.error('Camera access error:', err);
      setHasCamera(false);
      const name = err && (err.name || err.type);
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        onError(new Error('Camera permission denied. Please allow camera access in your browser settings.'));
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        onError(new Error('No camera found on this device.'));
      } else {
        onError(new Error('Could not access camera. Please check browser permissions and try again.'));
      }
    }
  };

  const initializeScanner = async () => {
    if (scannerRef.current) {
      return;
    }

    const scanner = new Html5Qrcode("qr-reader");
    scannerRef.current = scanner;
    isStopping.current = false;

    try {
      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 15,
          qrbox: (viewfinderWidth, viewfinderHeight) => {
            const size = Math.min(viewfinderWidth, viewfinderHeight);
            return { width: size, height: size };
          },
        },
        onScanSuccessHandler,
        () => { }
      );

      try {
        await scanner.applyVideoConstraints({
          width: { ideal: 3840 },
          height: { ideal: 2160 },
          advanced: [{ focusMode: "continuous" }],
        });
      } catch {}

      // wait one frame so the video track is live before probing capabilities
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));

      try {
        const video = document.querySelector('#qr-reader video');
        if (video && video.srcObject) {
          const track = video.srcObject.getVideoTracks()[0];
          if (track) {
            trackRef.current = track;
            const capabilities = track.getCapabilities();
            if (capabilities.zoom) {
              setZoomCapability({ min: capabilities.zoom.min, max: capabilities.zoom.max, step: capabilities.zoom.step || 0.1 });
              setZoomLevel(track.getSettings().zoom || capabilities.zoom.min);
            }
          }
        }
      } catch {}
    } catch (err) {
      console.error('Scanner start error:', err);
      onError(new Error('Failed to start camera. Please try again.'));
    }
  };

  const onScanSuccessHandler = async (decodedText) => {
    if (isStopping.current) return;

    let token = null;

    try {
      try {
        const url = new URL(decodedText);
        token = url.searchParams.get('token');
      } catch {
        try {
          const qrData = JSON.parse(decodedText);
          token = qrData.token;
        } catch { }
      }

      if (!token) {
        onError(new Error('Invalid QR code format.'));
        return;
      }

      isStopping.current = true;
      await stopScanner();
      setIsScanning(false);

      onScanSuccess(token);
    } catch (err) {
      isStopping.current = true;
      await stopScanner();
      setIsScanning(false);
      onError(err);
    }
  };

  const handleZoomChange = async (newZoom) => {
    setZoomLevel(newZoom);
    if (trackRef.current) {
      try {
        await trackRef.current.applyConstraints({ advanced: [{ zoom: newZoom }] });
      } catch {}
    }
  };

  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch {}
      scannerRef.current = null;
    }
    trackRef.current = null;
    setZoomCapability(null);
    setZoomLevel(1);

    const video = document.querySelector('#qr-reader video');
    if (video && video.srcObject) {
      video.srcObject.getTracks().forEach(track => track.stop());
      video.srcObject = null;
    }
  };

  const handleCancel = async () => {
    await stopScanner();
    setIsScanning(false);
  };

  if (!hasCamera) {
    return (
      <div className="qr-scanner-error-state">
        <h3>Camera not available</h3>
        <p>Please allow camera access and try again</p>
        <button onClick={startScanner} className="btn btn-primary">
          Try Again
        </button>
      </div>
    );
  }

  if (!isScanning) {
    return (
      <div className="qr-scanner-start">
        <button onClick={startScanner} className="btn btn-primary">
          Start Camera
        </button>
      </div>
    );
  }

  return (
    <div className="qr-scanner-active">
      <div id="qr-reader"></div>
      <div className="scanner-controls">
        {zoomCapability && (
          <div className="zoom-control">
            {[1, 2, 4].filter(z => z <= zoomCapability.max).map(z => (
              <button
                key={z}
                className={`zoom-btn ${Math.abs(zoomLevel - z) < 0.1 ? 'zoom-btn-active' : ''}`}
                onClick={() => handleZoomChange(z)}
              >
                {z}x
              </button>
            ))}
            {zoomCapability.max > 4 && (
              <button
                className={`zoom-btn ${Math.abs(zoomLevel - zoomCapability.max) < 0.1 ? 'zoom-btn-active' : ''}`}
                onClick={() => handleZoomChange(zoomCapability.max)}
              >
                {Math.round(zoomCapability.max)}x
              </button>
            )}
          </div>
        )}
        <button onClick={handleCancel} className="btn-cancel">
          Stop Camera
        </button>
      </div>
    </div>
  );
}

export default QRScanner;