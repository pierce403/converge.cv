import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

interface QRScannerProps {
  onScan: (data: string) => void;
  onClose: () => void;
}

export function QRScanner({ onScan, onClose }: QRScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string>('');
  const [isScanning, setIsScanning] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let animationFrame: number;

    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' }, // Use back camera on mobile
        });
        
        streamRef.current = stream;
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
          setIsScanning(true);
        }
      } catch (err) {
        console.error('Camera access error:', err);
        setError('Could not access camera. Please check permissions.');
      }
    };

    const scanQRCode = () => {
      if (!videoRef.current || !canvasRef.current || !isScanning) {
        animationFrame = requestAnimationFrame(scanQRCode);
        return;
      }

      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');

      if (!ctx || video.readyState !== video.HAVE_ENOUGH_DATA) {
        animationFrame = requestAnimationFrame(scanQRCode);
        return;
      }

      // Set canvas size to video size
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      // Draw video frame to canvas
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Get image data
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      // Scan for QR code
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert',
      });

      if (code) {
        console.log('[QRScanner] Found QR code:', code.data);
        onScan(code.data);
        cleanup();
        return;
      }

      // Continue scanning
      animationFrame = requestAnimationFrame(scanQRCode);
    };

    const cleanup = () => {
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      setIsScanning(false);
    };

    startCamera();
    animationFrame = requestAnimationFrame(scanQRCode);

    return cleanup;
  }, [onScan, isScanning]);

  const handleClose = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black">
      {/* Close button */}
      <button
        onClick={handleClose}
        className="absolute top-4 right-4 z-10 p-2 bg-white/10 hover:bg-white/20 rounded-lg text-white"
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* Instructions */}
      <div className="absolute top-4 left-4 right-4 z-10 text-center">
        <div className="bg-black/60 backdrop-blur-sm rounded-lg px-4 py-2 text-white">
          <p className="text-sm font-medium">Scan QR Code</p>
          <p className="text-xs text-white/80 mt-1">Position the QR code within the frame</p>
        </div>
      </div>

      {/* Video element */}
      <video
        ref={videoRef}
        className="max-w-full max-h-full"
        playsInline
        muted
      />

      {/* Hidden canvas for processing */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Scanning overlay */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-64 h-64 border-4 border-accent-400 rounded-lg shadow-xl">
          <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-accent-400"></div>
          <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-accent-400"></div>
          <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-accent-400"></div>
          <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-accent-400"></div>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="absolute bottom-4 left-4 right-4 bg-red-900/90 text-white px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}
    </div>
  );
}

