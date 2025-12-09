import { useEffect, useState, useRef } from 'react';

export interface FarcasterSyncCheck {
  statusText: string;
  address?: string;
  userName?: string;
  fid?: number;
  action?: string;
  at: number;
}

interface FarcasterSyncModalProps {
  isOpen: boolean;
  current: number;
  total: number;
  status?: string;
  log?: string[];
  checks?: FarcasterSyncCheck[];
  accountName?: string;
  accountFid?: number;
  onClose: () => void;
}

export function FarcasterSyncModal({
  isOpen,
  current,
  total,
  status,
  log = [],
  checks = [],
  accountName,
  accountFid,
  onClose,
}: FarcasterSyncModalProps) {
  const [isClosing, setIsClosing] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const checksEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new log entries are added
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [log]);

  useEffect(() => {
    if (checksEndRef.current) {
      checksEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [checks]);

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
  const formatAddress = (addr?: string) => {
    if (!addr) return 'Unknown address';
    return addr.length > 24 ? `${addr.slice(0, 10)}…${addr.slice(-6)}` : addr;
  };
  const actionBadgeClasses = (action?: string) => {
    switch (action) {
      case 'skip':
        return 'text-amber-200 bg-amber-500/10 border border-amber-500/40';
      case 'save':
      case 'update':
        return 'text-accent-100 bg-accent-500/10 border border-accent-500/40';
      case 'error':
        return 'text-red-200 bg-red-500/10 border border-red-500/40';
      default:
        return 'text-primary-200 bg-primary-500/10 border border-primary-500/40';
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className={`bg-primary-900 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col relative text-primary-50 transition-opacity ${isClosing ? 'opacity-0' : 'opacity-100'}`}>
        {/* Header */}
        <div className="flex flex-col items-center p-6 border-b border-primary-800">
          {/* Spinner */}
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-500 mb-4"></div>
          
          {/* Progress Text */}
          <h3 className="text-xl font-bold mb-2">Syncing Farcaster Contacts</h3>
          
          {/* Account Info */}
          {(accountName || accountFid) && (
            <p className="text-primary-300 text-sm mb-2">
              Account: {accountName || 'Unknown'} {accountFid && `(FID: ${accountFid})`}
            </p>
          )}
          
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

        {/* XMTP checks + Log */}
        <div className="flex-1 p-4 bg-primary-950/50 flex flex-col gap-4 overflow-hidden">
          <div className="rounded-lg border border-primary-800/70 bg-primary-900/50 p-3">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold text-primary-100">XMTP address checks</h4>
              <span className="text-xs text-primary-400">{checks.length} seen</span>
            </div>
            <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
              {checks.length === 0 ? (
                <p className="text-primary-400 italic text-sm">Waiting for XMTP checks...</p>
              ) : (
                checks.map((item, index) => (
                  <div key={`${item.at}-${index}`} className="flex items-start gap-2 text-sm">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs uppercase tracking-wide ${actionBadgeClasses(item.action)}`}
                    >
                      {item.action || 'check'}
                    </span>
                    <div className="flex flex-col leading-tight min-w-0">
                      <span
                        className="font-mono text-[11px] text-primary-100 truncate"
                        title={item.address || 'Unknown address'}
                      >
                        {formatAddress(item.address)}
                      </span>
                      <span className="text-xs text-primary-300 truncate">
                        {item.userName || (item.fid ? `FID ${item.fid}` : 'Unknown user')} • {item.statusText}
                      </span>
                    </div>
                  </div>
                ))
              )}
              <div ref={checksEndRef} />
            </div>
          </div>

          <div className="rounded-lg border border-primary-800/70 bg-primary-900/50 p-3 flex-1 min-h-[140px]">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold text-primary-100">Event log</h4>
              <span className="text-xs text-primary-400">{log.length} entries</span>
            </div>
            <div className="h-40 overflow-y-auto pr-1 space-y-1 font-mono text-xs">
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
