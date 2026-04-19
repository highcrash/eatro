import React, { useState } from 'react';
import type { LicenseVerdict, LicenseError } from '../preload/index';

/**
 * First step on a fresh terminal — runs BEFORE FirstRunSetup. The cashier
 * (or whoever's setting up the box) pastes the purchase code they got
 * from the seller's checkout, and we POST it through the main process
 * to the license server. On success we hand back the active verdict so
 * App.tsx can move on to the device-pairing step.
 *
 * One license per Windows install — bound to the machine fingerprint
 * read in main/license/fingerprint.ts. Activating again on this same
 * box returns the same slot (idempotent); activating on a different
 * box uses a different slot and either succeeds (if maxActivations
 * allows another) or fails with CODE_EXHAUSTED.
 */

interface Props {
  onActivated: (verdict: LicenseVerdict) => void;
}

export function LicenseStep({ onActivated }: Props): JSX.Element {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await window.desktop.license.activate(code);
    setBusy(false);
    if ('error' in res && res.error) {
      setError(res.message);
      return;
    }
    onActivated(res as LicenseVerdict);
  }

  // Format-as-you-type: groups of 8 separated by hyphens, uppercase.
  function onCodeChange(value: string) {
    const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 32);
    const grouped = cleaned.match(/.{1,8}/g)?.join('-') ?? cleaned;
    setCode(grouped);
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <p style={styles.kicker}>Step 1 of 2 · License</p>
        <h1 style={styles.title}>ACTIVATE THIS TERMINAL</h1>
        <p style={styles.body}>
          Enter the purchase code from your order receipt. Each code activates
          one Windows install — moving to a different machine later requires
          deactivating here first.
        </p>

        <label style={styles.label}>
          Purchase code
          <input
            type="text"
            value={code}
            onChange={(e) => onCodeChange(e.target.value)}
            placeholder="XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX"
            autoFocus
            spellCheck={false}
            autoComplete="off"
            style={styles.input}
            onKeyDown={(e) => { if (e.key === 'Enter' && !busy && code.length >= 35) void submit(); }}
          />
        </label>

        {error && <p style={styles.error}>{error}</p>}

        <button
          onClick={() => void submit()}
          disabled={busy || code.length < 35}
          style={{ ...styles.btnPrimary, opacity: busy || code.length < 35 ? 0.5 : 1 }}
        >
          {busy ? 'Activating…' : 'Activate'}
        </button>

        <p style={styles.hint}>
          Lost your code? Check the order email from the seller, or contact
          support — they can re-send it tied to the same purchase.
        </p>
      </div>
    </div>
  );
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
  title: { fontSize: 22, letterSpacing: 3, margin: '4px 0 8px' },
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
  btnPrimary: {
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
    marginTop: 12,
  },
  hint: { color: '#666', fontSize: 11, margin: '12px 0 0', lineHeight: 1.6 },
};

// Suppress unused-import warning when this file is imported into App.tsx
// before LicenseError surfaces in the union return type.
export type { LicenseError };
