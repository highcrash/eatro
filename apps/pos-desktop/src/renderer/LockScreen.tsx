import React, { useEffect, useState } from 'react';
import type { CashierTile, SessionUser } from './desktop-api';

type View =
  | { kind: 'grid' }
  | { kind: 'pin'; cashier: CashierTile }
  | { kind: 'first-time'; cashier: CashierTile }
  // Forgot-PIN reset uses the same form as first-time setup (verify
  // password, pick a new PIN) but with copy that says "Reset" instead
  // of "Set" so the cashier knows their old PIN is being replaced.
  | { kind: 'forgot-pin'; cashier: CashierTile };

interface Props {
  onSignedIn: (user: SessionUser) => void;
  deviceName: string;
  branchName: string;
  onUnpair: () => void;
}

export function LockScreen({ onSignedIn, deviceName, branchName, onUnpair }: Props): JSX.Element {
  const [cashiers, setCashiers] = useState<CashierTile[] | null>(null);
  const [view, setView] = useState<View>({ kind: 'grid' });

  useEffect(() => {
    void (async () => {
      const list = await window.desktop.cashier.list();
      setCashiers(list);
    })();
  }, []);

  const onPick = (c: CashierTile) => {
    setView(c.hasPin ? { kind: 'pin', cashier: c } : { kind: 'first-time', cashier: c });
  };

  if (view.kind === 'pin') {
    return (
      <PinPad
        cashier={view.cashier}
        onBack={() => setView({ kind: 'grid' })}
        onForgot={() => setView({ kind: 'forgot-pin', cashier: view.cashier })}
        onSignedIn={onSignedIn}
      />
    );
  }
  if (view.kind === 'first-time') {
    return (
      <FirstTimePin
        cashier={view.cashier}
        mode="first-time"
        onBack={() => setView({ kind: 'grid' })}
        onSignedIn={onSignedIn}
      />
    );
  }
  if (view.kind === 'forgot-pin') {
    return (
      <FirstTimePin
        cashier={view.cashier}
        mode="reset"
        onBack={() => setView({ kind: 'pin', cashier: view.cashier })}
        onSignedIn={onSignedIn}
      />
    );
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <p style={styles.kicker}>{branchName}</p>
        <h1 style={styles.title}>TAP YOUR NAME</h1>
        <p style={styles.sub}>{deviceName}</p>
      </header>

      {cashiers === null ? (
        <p style={{ color: '#888' }}>Loading…</p>
      ) : cashiers.length === 0 ? (
        <p style={{ color: '#888' }}>No cashiers found for this branch.</p>
      ) : (
        <div style={styles.grid}>
          {cashiers.map((c) => (
            <button key={c.id} onClick={() => onPick(c)} style={styles.tile}>
              <div style={styles.avatar}>{initials(c.name)}</div>
              <div style={styles.tileName}>{c.name}</div>
              <div style={styles.tileRole}>{c.role}</div>
              {!c.hasPin && <div style={styles.noPin}>Set PIN</div>}
            </button>
          ))}
        </div>
      )}

      <footer style={styles.footer}>
        <button onClick={onUnpair} style={styles.unpair}>
          Unpair this terminal
        </button>
      </footer>
    </div>
  );
}

/* ── PIN PAD ─────────────────────────────────────────────────────────────── */

function PinPad({
  cashier,
  onBack,
  onForgot,
  onSignedIn,
}: {
  cashier: CashierTile;
  onBack: () => void;
  onForgot: () => void;
  onSignedIn: (user: SessionUser) => void;
}): JSX.Element {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lockedUntilMs, setLockedUntilMs] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const pinRef = React.useRef(pin);
  pinRef.current = pin;

  useEffect(() => {
    if (!lockedUntilMs) return;
    const i = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(i);
  }, [lockedUntilMs]);

  const isLocked = lockedUntilMs != null && lockedUntilMs > now;

  const submit = React.useCallback(async (final: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await window.desktop.cashier.verifyPin({ staffId: cashier.id, pin: final });
      if (res.ok) {
        onSignedIn(res.user);
        return;
      }
      if (res.reason === 'locked') {
        setLockedUntilMs(res.lockedUntilMs);
        setError(null);
      } else if (res.reason === 'wrong') {
        if (res.lockedUntilMs) setLockedUntilMs(res.lockedUntilMs);
        setError(`Wrong PIN (${res.failedAttempts} failed)`);
      } else if (res.reason === 'no-pin') {
        setError('No PIN set for this cashier yet.');
      } else if (res.reason === 'server') {
        setError(res.message);
      }
      setPin('');
    } finally {
      setBusy(false);
    }
  }, [busy, cashier.id, onSignedIn]);

  // Auto-submit when typing stops. 4 digits is the minimum so we debounce
  // a bit longer than a rapid typist's inter-key interval; if the cashier
  // has a 5- or 6-digit PIN the debounce resets with each digit and only
  // fires after the final one.
  useEffect(() => {
    if (isLocked || busy) return;
    if (pin.length < 4) return;
    const t = setTimeout(() => {
      void submit(pinRef.current);
    }, pin.length >= 6 ? 80 : 450);
    return () => clearTimeout(t);
  }, [pin, isLocked, busy, submit]);

  // Hardware keyboard: digits, Backspace, Enter, Escape. Runs at window
  // scope so no input focus is required — the cashier just starts typing.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isLocked || busy) return;
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        setPin((p) => (p.length >= 6 ? p : p + e.key));
        setError(null);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        setPin((p) => p.slice(0, -1));
        setError(null);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (pinRef.current.length >= 4) void submit(pinRef.current);
        else setError('PIN must be at least 4 digits');
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setPin('');
        setError(null);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isLocked, busy, submit]);

  function tap(d: string) {
    if (isLocked || busy) return;
    if (d === 'back') {
      setPin((p) => p.slice(0, -1));
      setError(null);
      return;
    }
    if (d === 'clear') {
      setPin('');
      setError(null);
      return;
    }
    if (pin.length >= 6) return;
    setPin((p) => p + d);
    setError(null);
  }

  function onEnter() {
    if (pin.length < 4) {
      setError('PIN must be at least 4 digits');
      return;
    }
    void submit(pin);
  }

  const secondsLeft = lockedUntilMs ? Math.max(0, Math.ceil((lockedUntilMs - now) / 1000)) : 0;

  return (
    <div style={styles.page}>
      <div style={styles.pinBox}>
        <div style={styles.avatarLarge}>{initials(cashier.name)}</div>
        <h2 style={styles.pinName}>{cashier.name}</h2>
        <p style={styles.pinRole}>{cashier.role}</p>

        <div style={styles.pinDisplay}>
          {Array.from({ length: Math.max(pin.length, 4) }, (_, i) => (
            <div
              key={i}
              style={{
                ...styles.pinDot,
                background: i < pin.length ? '#D62B2B' : '#2A2A2A',
              }}
            />
          ))}
        </div>

        {isLocked && (
          <p style={styles.lockedMsg}>Locked. Try again in {secondsLeft}s.</p>
        )}
        {error && !isLocked && <p style={styles.errorMsg}>{error}</p>}

        <div style={styles.pinGrid}>
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'].map((k) => (
            <button
              key={k}
              onClick={() => tap(k)}
              disabled={isLocked || busy}
              style={{
                ...styles.pinKey,
                ...(k === 'clear' || k === 'back' ? styles.pinKeySmall : {}),
              }}
            >
              {k === 'back' ? '←' : k === 'clear' ? 'C' : k}
            </button>
          ))}
        </div>

        <div style={styles.pinActions}>
          <button onClick={onBack} style={styles.btnSecondary}>Back</button>
          <button onClick={onEnter} disabled={isLocked || busy || pin.length < 4} style={styles.btnPrimary}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </div>

        {/* Escape valve when the cashier can't recall their PIN. Routes
            to the same form we use for first-time setup; password +
            new PIN replace the old hash via the existing setPin IPC. */}
        <button onClick={onForgot} disabled={busy} style={styles.forgotLink}>
          Forgot PIN? Reset with password
        </button>
      </div>
    </div>
  );
}

/* ── FIRST-TIME PIN SETUP ─────────────────────────────────────────────────── */

function FirstTimePin({
  cashier,
  mode,
  onBack,
  onSignedIn,
}: {
  cashier: CashierTile;
  /** "first-time" — cashier never set a PIN on this terminal.
   *  "reset"     — cashier forgot their existing PIN; we'll
   *                overwrite the local hash. Same backend path. */
  mode: 'first-time' | 'reset';
  onBack: () => void;
  onSignedIn: (user: SessionUser) => void;
}): JSX.Element {
  const [step, setStep] = useState<'password' | 'pin'>('password');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    if (step === 'password') {
      if (!password) { setError('Password required'); return; }
      if (!/^\d{4,6}$/.test(pin)) { setError('PIN must be 4 to 6 digits'); return; }
      if (pin !== pin2) { setError('PINs do not match'); return; }

      setBusy(true);
      try {
        const res = await window.desktop.cashier.setPin({
          email: cashier.email,
          password,
          pin,
        });
        if (res.ok) {
          onSignedIn(res.user);
        } else {
          setError(res.message);
        }
      } finally {
        setBusy(false);
      }
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.pinBox}>
        <div style={styles.avatarLarge}>{initials(cashier.name)}</div>
        <h2 style={styles.pinName}>{cashier.name}</h2>
        <p style={styles.pinRole}>
          {mode === 'reset' ? 'Reset PIN with password' : 'First time on this terminal'}
        </p>

        <p style={styles.setPinHelp}>
          {mode === 'reset'
            ? 'Enter your Your Restaurant password to authorise the reset, then choose a new 4–6 digit PIN. The old PIN on this terminal is replaced; the password itself is never stored here.'
            : "Prove it's you with your Your Restaurant password, then pick a 4–6 digit PIN you'll use on this terminal. The password is never stored here."}
        </p>

        <div style={styles.setPinForm}>
          <label style={styles.setPinLabel}>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              autoComplete="current-password"
              style={styles.setPinInput}
            />
          </label>
          <label style={styles.setPinLabel}>
            New PIN (4–6 digits)
            <input
              inputMode="numeric"
              pattern="\d*"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              style={styles.setPinInput}
            />
          </label>
          <label style={styles.setPinLabel}>
            Confirm PIN
            <input
              inputMode="numeric"
              pattern="\d*"
              maxLength={6}
              value={pin2}
              onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))}
              style={styles.setPinInput}
            />
          </label>
        </div>

        {error && <p style={styles.errorMsg}>{error}</p>}

        <div style={styles.pinActions}>
          <button onClick={onBack} style={styles.btnSecondary}>Back</button>
          <button onClick={() => void submit()} disabled={busy} style={styles.btnPrimary}>
            {busy ? 'Saving…' : mode === 'reset' ? 'Reset PIN & sign in' : 'Set PIN & sign in'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── utils + styles ───────────────────────────────────────────────────────── */

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#0D0D0D',
    color: '#fff',
    fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
    padding: 32,
    display: 'flex',
    flexDirection: 'column',
  },
  header: { textAlign: 'center', marginBottom: 24 },
  kicker: { color: '#D62B2B', fontSize: 11, letterSpacing: 4, textTransform: 'uppercase', margin: 0 },
  title: { fontSize: 36, letterSpacing: 4, margin: '8px 0 4px' },
  sub: { color: '#666', fontSize: 12, margin: 0, letterSpacing: 2, textTransform: 'uppercase' },

  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: 12,
    maxWidth: 1100,
    margin: '0 auto',
    width: '100%',
  },
  tile: {
    background: '#161616',
    border: '1px solid #2A2A2A',
    padding: '24px 16px',
    cursor: 'pointer',
    color: '#fff',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 10,
    transition: 'border-color 120ms, transform 120ms',
  },
  avatar: {
    width: 64,
    height: 64,
    background: '#2A2A2A',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 24,
    fontWeight: 600,
    letterSpacing: 1,
  },
  tileName: { fontSize: 15, fontWeight: 500 },
  tileRole: { fontSize: 10, letterSpacing: 2, color: '#888', textTransform: 'uppercase' },
  noPin: {
    fontSize: 9,
    letterSpacing: 2,
    background: '#D62B2B20',
    color: '#D62B2B',
    padding: '2px 8px',
    textTransform: 'uppercase',
    fontWeight: 600,
  },

  footer: { marginTop: 'auto', textAlign: 'center' },
  unpair: {
    background: 'transparent',
    border: '1px solid #2A2A2A',
    color: '#555',
    padding: '6px 14px',
    fontSize: 10,
    letterSpacing: 2,
    textTransform: 'uppercase',
    cursor: 'pointer',
  },

  pinBox: {
    maxWidth: 420,
    margin: '0 auto',
    width: '100%',
    textAlign: 'center',
    paddingTop: 32,
  },
  avatarLarge: {
    width: 96,
    height: 96,
    background: '#2A2A2A',
    margin: '0 auto',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 32,
    fontWeight: 600,
  },
  pinName: { fontSize: 22, letterSpacing: 2, margin: '16px 0 0' },
  pinRole: { color: '#666', fontSize: 10, letterSpacing: 3, margin: '4px 0 24px', textTransform: 'uppercase' },
  pinDisplay: { display: 'flex', gap: 12, justifyContent: 'center', marginBottom: 16 },
  pinDot: { width: 14, height: 14, borderRadius: 0, transition: 'background 120ms' },
  errorMsg: { color: '#F03535', fontSize: 12, minHeight: 18, margin: '0 0 8px' },
  lockedMsg: { color: '#F03535', fontSize: 14, margin: '0 0 12px', fontWeight: 500 },

  pinGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 8,
    margin: '12px 0',
  },
  pinKey: {
    background: '#161616',
    border: '1px solid #2A2A2A',
    color: '#fff',
    padding: '18px 0',
    fontSize: 22,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  pinKeySmall: { color: '#888', fontSize: 18 },
  pinActions: { display: 'flex', gap: 8, marginTop: 16 },

  forgotLink: {
    marginTop: 12,
    width: '100%',
    background: 'transparent',
    border: 'none',
    color: '#888',
    padding: 8,
    fontSize: 11,
    letterSpacing: 1,
    cursor: 'pointer',
    fontFamily: 'inherit',
    textDecoration: 'underline',
  },

  btnSecondary: {
    flex: 1,
    background: 'transparent',
    border: '1px solid #2A2A2A',
    color: '#999',
    padding: 12,
    fontSize: 11,
    letterSpacing: 3,
    textTransform: 'uppercase',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  btnPrimary: {
    flex: 1,
    background: '#D62B2B',
    border: 'none',
    color: '#fff',
    padding: 12,
    fontSize: 11,
    letterSpacing: 3,
    textTransform: 'uppercase',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontWeight: 600,
  },

  setPinHelp: { color: '#888', fontSize: 12, margin: '0 0 24px', lineHeight: 1.6 },
  setPinForm: { display: 'flex', flexDirection: 'column', gap: 12 },
  setPinLabel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    textAlign: 'left',
    fontSize: 10,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: '#666',
  },
  setPinInput: {
    background: '#0D0D0D',
    border: '1px solid #2A2A2A',
    color: '#fff',
    padding: '10px 12px',
    fontSize: 14,
    fontFamily: 'inherit',
    outline: 'none',
  },
};
