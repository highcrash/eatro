import React, { useState } from 'react';
import type { PairedConfig } from './desktop-api';

interface Props {
  onPaired: (cfg: PairedConfig) => void;
}

/**
 * First-time device pairing screen. Shown when no encrypted config exists.
 * Owner enters the API server URL + their credentials + a terminal name;
 * the main process calls POST /devices/register and stores the returned
 * device token encrypted via DPAPI.
 *
 * After success, the cashier lock screen (Phase 2) takes over. For now we
 * just hand the paired config up to the top-level App.
 */
export function FirstRunSetup({ onPaired }: Props): JSX.Element {
  const [serverUrl, setServerUrl] = useState('http://localhost:3001');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [branchId, setBranchId] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const cfg = await window.desktop.device.register({
        serverUrl: serverUrl.trim(),
        email: email.trim(),
        password,
        branchId: branchId.trim(),
        deviceName: deviceName.trim() || 'Cashier Terminal',
      });
      onPaired(cfg);
    } catch (err) {
      setError((err as Error).message || 'Pairing failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={styles.page}>
      <form onSubmit={onSubmit} style={styles.card}>
        <p style={styles.kicker}>Setup</p>
        <h1 style={styles.title}>PAIR THIS TERMINAL</h1>
        <p style={styles.subtitle}>
          Enter your Restora server details and owner credentials. This runs once — the device is
          permanently registered to this branch after setup.
        </p>

        <Field label="Server URL">
          <input
            type="url"
            required
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="https://api.your-domain.com"
            style={styles.input}
          />
        </Field>

        <Field label="Owner email">
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={styles.input}
          />
        </Field>

        <Field label="Owner password">
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={styles.input}
          />
        </Field>

        <Field label="Branch ID">
          <input
            type="text"
            required
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            placeholder="The branch this terminal belongs to"
            style={styles.input}
          />
        </Field>

        <Field label="Terminal name">
          <input
            type="text"
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
            placeholder="Front Counter"
            style={styles.input}
          />
        </Field>

        {error && <p style={styles.error}>{error}</p>}

        <button type="submit" disabled={busy} style={styles.button}>
          {busy ? 'Pairing…' : 'Pair terminal'}
        </button>

        <p style={styles.footnote}>
          The owner password is never stored on this machine. Only an opaque device token is saved
          (encrypted with Windows DPAPI).
        </p>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label style={styles.field}>
      <span style={styles.label}>{label}</span>
      {children}
    </label>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#0D0D0D',
    color: '#fff',
    fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 460,
    background: '#161616',
    border: '1px solid #2A2A2A',
    padding: 32,
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  kicker: {
    color: '#D62B2B',
    fontSize: 11,
    letterSpacing: 4,
    textTransform: 'uppercase',
    margin: 0,
  },
  title: {
    fontSize: 28,
    letterSpacing: 3,
    margin: '4px 0 6px',
  },
  subtitle: {
    color: '#999',
    fontSize: 13,
    lineHeight: 1.5,
    marginBottom: 12,
    marginTop: 0,
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  label: {
    color: '#666',
    fontSize: 10,
    letterSpacing: 2,
    textTransform: 'uppercase',
    fontWeight: 500,
  },
  input: {
    background: '#0D0D0D',
    border: '1px solid #2A2A2A',
    color: '#fff',
    padding: '10px 12px',
    fontSize: 14,
    fontFamily: 'inherit',
    outline: 'none',
  },
  button: {
    background: '#D62B2B',
    border: 'none',
    color: '#fff',
    padding: '12px',
    fontSize: 12,
    letterSpacing: 3,
    textTransform: 'uppercase',
    fontWeight: 600,
    cursor: 'pointer',
    marginTop: 8,
  },
  error: {
    color: '#F03535',
    fontSize: 12,
    margin: '4px 0',
  },
  footnote: {
    color: '#555',
    fontSize: 11,
    lineHeight: 1.5,
    marginTop: 8,
    marginBottom: 0,
  },
};
