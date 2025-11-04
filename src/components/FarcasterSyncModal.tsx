import { useEffect, useState, useRef } from 'react';

interface FarcasterSyncModalProps {
  isOpen: boolean;
  current: number;
  total: number;
  status?: string;
  log?: string[];
  onClose: () => void;
}

export function FarcasterSyncModal({ isOpen, current, total, status, log = [], onClose }: FarcasterSyncModalProps) {
  const [isClosing, setIsClosing] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new log entries are added
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [log]);

  useEffect(() => {
    // Auto-close when sync completes
    if (isOpen && current === total && total > 0) {
      const timer = setTimeout(() => {
        setIsClosing(true);
        setTimeout(() => {
          onClose();
          setIsClosing(false);
        }, 300);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [isOpen, current, total, onClose]);

  if (!isOpen) return null;

  const progress = total > 0 ? (current / total) * 100 : 0;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className={`bg-primary-900 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col relative text-primary-50 transition-opacity ${isClosing ? 'opacity-0' : 'opacity-100'}`}>
        {/* Header */}
        <div className="flex flex-col items-center p-6 border-b border-primary-800">
          {/* Spinner */}
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-500 mb-4"></div>
          
          {/* Progress Text */}
          <h3 className="text-xl font-bold mb-2">Syncing Farcaster Contacts</h3>
          
          {/* Status Message */}
          {status && (
            <p className="text-primary-200 text-sm mb-2 font-medium">{status}</p>
          )}
          
          {total > 0 ? (
            <>
              <p className="text-primary-300 mb-2">
                Progress: {current} of {total} contacts processed
              </p>
              
              {/* Progress Bar */}
              <div className="w-full bg-primary-800 rounded-full h-3 mb-2">
                <div
                  className="bg-accent-500 h-3 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                ></div>
              </div>
              
              <p className="text-primary-400 text-xs">
                {progress.toFixed(1)}% complete
              </p>
            </>
          ) : (
            <p className="text-primary-300">Initializing sync...</p>
          )}
        </div>

        {/* Scrolling Console */}
        <div className="flex-1 overflow-y-auto p-4 bg-primary-950/50">
          <div className="space-y-1 font-mono text-xs">
            {log.length === 0 ? (
              <p className="text-primary-400 italic">Waiting for sync to start...</p>
            ) : (
              log.map((message, index) => (
                <div key={index} className="text-primary-300">
                  <span className="text-primary-500 mr-2">[{new Date().toLocaleTimeString()}]</span>
                  {message}
                </div>
              ))
            )}
            <div ref={logEndRef} />
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-primary-800">
          <button
            onClick={() => {
              setIsClosing(true);
              setTimeout(() => {
                onClose();
                setIsClosing(false);
              }, 300);
            }}
            className="text-primary-300 hover:text-primary-50 text-sm underline w-full text-center"
          >
            Dismiss (sync continues in background)
          </button>
        </div>
      </div>
    </div>
  );
}

