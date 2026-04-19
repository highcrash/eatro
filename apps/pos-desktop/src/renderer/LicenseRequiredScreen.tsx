import React, { useState } from 'react';
import type { LicenseVerdict } from '../preload/index';

/**
 * Hard takeover shown when the license verdict transitions to `locked`
 * (REVOKED, EXPIRED, or grace window blown). Mirrors the structure of
 * RevokedScreen.tsx — full-screen, blocks every other UI path — but the
 * recovery is "deactivate + re-activate" rather than "unpair".
 *
 * The cashier sees this; the OWNER recovers. We don't gate the recovery
 * action on owner password here because:
 *   1. Re-activation requires a NEW purchase code (the revoked one
 *      stays sticky server-side), which a malicious passing cashier
 *      doesn't have.
 *   2. The "deactivate" button only releases the local cache + the
 *      server slot — it can't put the terminal in a worse state than
 *      it's already in (locked).
 */

interface Props {
  verdict: LicenseVerdict;
  onRecovered: (verdict: LicenseVerdict) => void;
}

export function LicenseRequiredScreen({ verdict, onRecovered }: Props): JSX.Element {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onCodeChange(value: string) {
    const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 32);
    const grouped = cleaned.match(/.{1,8}/g)?.join('-') ?? cleaned;
    setCode(grouped);
  }

  async function activate() {
    setBusy(true);
    setError(null);
    const res = await window.desktop.license.activate(code);
    setBusy(false);
    if ('error' in res && res.error) {
      setError(res.message);
      return;
    }
    onRecovered(res as LicenseVerdict);
  }

  async function deactivate() {
    setBusy(true);
    setError(null);
    await window.desktop.license.deactivate();
    setBusy(false);
    // Stay on this screen; renderer will see verdict=missing on next
    // status poll, which the App-level effect translates back to the
    // first-run LicenseStep flow.
    onRecovered({ ...verdict, mode: 'missing', status: null });
  }

  const headline = headlineFor(verdict);
  const subline = sublineFor(verdict);

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <p style={styles.kicker}>License required</p>
        <h1 style={styles.title}>{headline}</h1>
        <p style={styles.sub}>{subline}</p>

        <p style={styles.body}>
          To bring this terminal back into service, paste a fresh purchase
          code below and activate. If your previous code was revoked by the
          seller, you'll need a new one — codes can't be re-used after
          revocation.
        </p>

        <label style={styles.label}>
          New purchase code
          <input
            type="text"
            value={code}
            onChange={(e) => onCodeChange(e.target.value)}
            placeholder="XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX"
            spellCheck={false}
            autoComplete="off"
            style={styles.input}
          />
        </label>

        {error && <p style={styles.error}>{error}</p>}

        <div style={styles.actions}>
          <button
            onClick={() => void activate()}
            disabled={busy || code.length < 35}
            style={{ ...styles.btnPrimary, opacity: busy || code.length < 35 ? 0.5 : 1 }}
          >
            {busy ? 'Activating…' : 'Activate'}
          </button>
          <button onClick={() => void deactivate()} disabled={busy} style={styles.btnSecondary}>
            Clear local license
          </button>
        </div>
      </div>
    </div>
  );
}

function headlineFor(v: LicenseVerdict): string {
  if (v.status === 'REVOKED') return 'LICENSE REVOKED';
  if (v.status === 'EXPIRED') return 'LICENSE EXPIRED';
  if (v.mode === 'locked') return 'LICENSE INACTIVE';
  return 'LICENSE REQUIRED';
}

function sublineFor(v: LicenseVerdict): string {
  if (v.reason) return v.reason;
  if (v.mode === 'grace' && v.graceDaysRemaining > 0) return `Offline grace — ${v.graceDaysRemaining} day(s) left.`;
  return 'This terminal cannot accept new orders until activation is restored.';
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#0D0D0D',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
    padding: 24,
  },
  card: {
    width: 540,
    background: '#161616',
    border: '1px solid #2A2A2A',
    padding: 32,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  kicker: { color: '#D62B2B', fontSize: 11, letterSpacing: 4, textTransform: 'uppercase', margin: 0 },
  title: { fontSize: 24, letterSpacing: 4, margin: '4px 0 4px' },
  sub: { color: '#bbb', fontSize: 12, margin: '0 0 8px', letterSpacing: 1 },
  body: { color: '#aaa', fontSize: 13, lineHeight: 1.6, margin: '0 0 8px' },
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    fontSize: 10,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: '#888',
    marginTop: 8,
  },
  input: {
    background: '#0D0D0D',
    border: '1px solid #2A2A2A',
    color: '#fff',
    padding: '14px 12px',
    fontSize: 15,
    fontFamily: 'ui-monospace, "SF Mono", Consolas, monospace',
    letterSpacing: 1,
    outline: 'none',
  },
  error: { color: '#F03535', fontSize: 12, margin: '4px 0 0' },
  actions: { display: 'flex', gap: 8, marginTop: 12 },
  btnPrimary: {
    flex: 1,
    background: '#D62B2B',
    color: '#fff',
    border: 'none',
    padding: '14px 20px',
    fontSize: 12,
    letterSpacing: 3,
    textTransform: 'uppercase',
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  btnSecondary: {
    background: 'transparent',
    border: '1px solid #2A2A2A',
    color: '#999',
    padding: '14px 20px',
    fontSize: 11,
    letterSpacing: 2,
    textTransform: 'uppercase',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
};
