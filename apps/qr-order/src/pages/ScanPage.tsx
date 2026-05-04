import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Camera, AlertTriangle } from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';

/**
 * In-app QR scanner for two scenarios:
 *   1. Customer landed on `/` (no tableId in URL) — needs to scan the
 *      table tent to start ordering.
 *   2. Customer mid-meal taps "Change table" on OrderStatusPage —
 *      route forwards them here with `?intent=change-table` so the
 *      success-path ends in TableEntry's move-table flow.
 *
 * After a successful decode we extract the tableId from the URL
 * payload (`/table/{cuid}` shape) and navigate to /table/:id, which
 * hands off to the existing TableEntry → server lookups → dedupe /
 * share-gate flow. No new server endpoints needed.
 *
 * iOS Safari requires camera-start to happen inside a user-gesture
 * — we render a "Start camera" button explicitly rather than auto-
 * starting on mount. Permission denial falls back to a manual
 * tableId paste field so the customer is never fully blocked.
 */
export default function ScanPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const intent = params.get('intent'); // 'change-table' or null
  const [phase, setPhase] = useState<'idle' | 'scanning' | 'denied' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [manualId, setManualId] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  useEffect(() => {
    return () => {
      // Stop the camera when the user leaves the page so the LED
      // turns off and other apps can grab the lens.
      const s = scannerRef.current;
      if (s) {
        s.stop().catch(() => {}).then(() => s.clear()).catch(() => {});
      }
    };
  }, []);

  /**
   * Pull a tableId out of a scanned/pasted payload. Accepts:
   *   - bare cuid (e.g. "cl1234567890abcdef") — used as-is
   *   - URL containing /table/{cuid} — extracts the cuid
   * Anything else (a URL with no /table/ segment, junk QR code,
   * empty string) returns null so the caller can show "not a table
   * code" instead of navigating to /table/garbage and 404'ing.
   */
  const extractTableId = (decoded: string): string | null => {
    const trimmed = decoded.trim();
    if (!trimmed) return null;
    const match = /\/table\/([a-z0-9-]+)/i.exec(trimmed);
    if (match) return match[1];
    // Bare-cuid path: must look like an opaque identifier (no scheme,
    // no slashes, plausible length). Reject `https://...` style URLs
    // that didn't match the /table/ pattern — navigating to
    // /table/{full-url} would just 404.
    if (/^[a-z0-9_-]{8,}$/i.test(trimmed)) return trimmed;
    return null;
  };

  const handleDecoded = async (decoded: string) => {
    // Stop the scanner before navigating so the camera releases —
    // otherwise the next route briefly shows a frozen viewfinder.
    const s = scannerRef.current;
    if (s) await s.stop().catch(() => {});

    const tableId = extractTableId(decoded);
    if (!tableId) {
      setErrorMsg('That QR code doesn\'t look like a table code. Try again.');
      setPhase('error');
      return;
    }
    void navigate(`/table/${tableId}`, { replace: true });
  };

  const startScanner = async () => {
    setErrorMsg(null);
    // Container is now ALWAYS rendered (just hidden until phase
    // flips to scanning) — earlier we conditionally mounted it on
    // phase === 'scanning' which meant the ref was null when the
    // button click ran startScanner from the idle screen, and the
    // function silently bailed on `if (!containerRef.current) return`.
    // That was the "Start camera button does nothing" bug.
    if (!containerRef.current) {
      setErrorMsg('Scanner failed to mount. Reload the page.');
      setPhase('error');
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      // Older browsers / non-secure context (http:// without
      // localhost) — getUserMedia is undefined. Surface a helpful
      // message instead of a cryptic "is not a function".
      setErrorMsg('Your browser blocked camera access. Open this page over HTTPS or use the manual entry below.');
      setPhase('error');
      return;
    }
    try {
      // Mounted DIV must have a stable id — html5-qrcode targets it
      // by id (not by ref). Set it once before instantiation.
      containerRef.current.id = 'qr-scanner-region';
      // Flip UI first so the viewfinder slot is visible while the
      // camera spins up (1–2 s on cold WebView). Otherwise users
      // tap the button, see no UI change for a beat, and tap again.
      setPhase('scanning');
      const scanner = new Html5Qrcode('qr-scanner-region', { verbose: false });
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: 'environment' }, // Rear camera by default.
        {
          fps: 10,
          qrbox: { width: 240, height: 240 },
          aspectRatio: 1,
        },
        (decoded) => { void handleDecoded(decoded); },
        () => { /* per-frame failures are noisy and not actionable */ },
      );
    } catch (e) {
      const msg = (e as Error)?.message ?? 'Camera failed';
      scannerRef.current = null;
      // The browser throws a NotAllowedError when the user denied or
      // dismissed the permission prompt. Surface a different fallback
      // path (manual paste) instead of the generic error screen.
      if (/permission|denied|notallowed/i.test(msg)) {
        setPhase('denied');
      } else {
        setErrorMsg(msg);
        setPhase('error');
      }
    }
  };

  const submitManual = () => {
    const tableId = extractTableId(manualId);
    if (!tableId) {
      setErrorMsg('That doesn\'t look like a table code. Paste either the bare id or a /table/{id} URL.');
      setPhase('error');
      return;
    }
    void navigate(`/table/${tableId}`, { replace: true });
  };

  return (
    <div className="min-h-screen bg-[#0D0D0D] text-white">
      <div className="px-5 py-4 flex items-center gap-3">
        <button
          onClick={() => void navigate(-1)}
          className="w-9 h-9 bg-[#1A1A1A] border border-[#2A2A2A] flex items-center justify-center"
          aria-label="Back"
        >
          <ArrowLeft size={16} />
        </button>
        <div>
          <p className="text-[10px] font-body text-[#666] tracking-widest uppercase">
            {intent === 'change-table' ? 'Change table' : 'Scan table QR'}
          </p>
          <h1 className="font-display text-lg tracking-wider">
            {intent === 'change-table' ? 'NEW TABLE' : 'START ORDER'}
          </h1>
        </div>
      </div>

      <div className="px-5 pb-10 space-y-5">
        {/* The viewfinder div is ALWAYS in the DOM — html5-qrcode
            targets it by id, and earlier we mounted it conditionally
            on phase === 'scanning' which made the ref null at the
            moment the user tapped Start (the button's startScanner
            silently bailed). Hide via display:none until scanning so
            the layout stays clean in idle/denied/error states. */}
        <div
          ref={containerRef}
          className="w-full aspect-square bg-black border border-[#2A2A2A] overflow-hidden"
          style={{ display: phase === 'scanning' ? 'block' : 'none' }}
        />

        {phase === 'idle' && (
          <>
            <div className="bg-[#1A1A1A] border border-[#2A2A2A] p-5 text-center space-y-4">
              <div className="mx-auto w-16 h-16 bg-[#C8FF00]/15 flex items-center justify-center">
                <Camera size={28} className="text-[#C8FF00]" />
              </div>
              <p className="text-sm font-body text-white">
                Point your camera at the QR code on your table tent.
              </p>
              <p className="text-xs font-body text-[#888]">
                We'll ask for camera permission first. The scanner closes as soon as we read the code.
              </p>
              <button
                onClick={() => void startScanner()}
                className="w-full bg-[#C8FF00] text-[#0D0D0D] font-body font-bold text-sm tracking-widest uppercase py-3 transition-opacity hover:opacity-90"
              >
                Start camera
              </button>
            </div>
            <ManualFallback manualId={manualId} setManualId={setManualId} onSubmit={submitManual} />
          </>
        )}

        {phase === 'scanning' && (
          <p className="text-center text-xs font-body text-[#888]">
            Centre the QR code in the frame. The page jumps when it's read.
          </p>
        )}

        {phase === 'denied' && (
          <div className="bg-[#FFA726]/10 border border-[#FFA726]/40 p-5 space-y-3">
            <div className="flex items-start gap-2">
              <AlertTriangle size={18} className="text-[#FFA726] mt-0.5 shrink-0" />
              <p className="text-sm font-body text-[#FFA726]">
                Camera permission needed. You can also type the table number from the QR code below.
              </p>
            </div>
            <ManualFallback manualId={manualId} setManualId={setManualId} onSubmit={submitManual} />
            <button
              onClick={() => { setPhase('idle'); }}
              className="w-full border border-[#FFA726]/40 text-[#FFA726] py-2 font-body font-medium text-xs tracking-widest uppercase"
            >
              Try camera again
            </button>
          </div>
        )}

        {phase === 'error' && (
          <div className="bg-[#F03535]/10 border border-[#F03535]/40 p-5 space-y-3">
            <div className="flex items-start gap-2">
              <AlertTriangle size={18} className="text-[#F03535] mt-0.5 shrink-0" />
              <p className="text-sm font-body text-[#F03535]">{errorMsg ?? 'Something went wrong with the camera.'}</p>
            </div>
            <ManualFallback manualId={manualId} setManualId={setManualId} onSubmit={submitManual} />
            <button
              onClick={() => { setPhase('idle'); setErrorMsg(null); }}
              className="w-full border border-[#F03535]/40 text-[#F03535] py-2 font-body font-medium text-xs tracking-widest uppercase"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ManualFallback({
  manualId,
  setManualId,
  onSubmit,
}: {
  manualId: string;
  setManualId: (v: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="space-y-2">
      <label className="text-[10px] font-body text-[#666] tracking-widest uppercase block">
        Or paste table id
      </label>
      <div className="flex gap-2">
        <input
          value={manualId}
          onChange={(e) => setManualId(e.target.value)}
          placeholder="cuid or full URL"
          className="flex-1 bg-[#1A1A1A] border border-[#2A2A2A] px-3 py-2.5 text-sm font-body text-white outline-none focus:border-[#C8FF00]"
        />
        <button
          onClick={onSubmit}
          disabled={manualId.trim().length < 6}
          className="bg-[#1A1A1A] border border-[#C8FF00] text-[#C8FF00] hover:bg-[#C8FF00] hover:text-[#0D0D0D] px-4 py-2.5 text-xs font-body font-bold tracking-widest uppercase disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Go
        </button>
      </div>
    </div>
  );
}
