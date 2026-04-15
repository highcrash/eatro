import React, { useEffect, useState } from 'react';
import type { UpdateStatus } from './desktop-api';

/**
 * Non-blocking update notifier. Shows as a thin pill in the bottom-left
 * of the window whenever the updater has something to report. Idle and
 * "up to date" states are invisible.
 */
export function UpdateToast(): JSX.Element | null {
  const [status, setStatus] = useState<UpdateStatus>({ kind: 'idle' });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    void window.desktop.update.status().then(setStatus);
    const off = window.desktop.update.onStatusChanged((s) => {
      setStatus(s);
      setDismissed(false); // any new state un-dismisses
    });
    return off;
  }, []);

  if (dismissed) return null;
  if (status.kind === 'idle' || status.kind === 'checking' || status.kind === 'none') return null;

  return (
    <div style={wrap}>
      {status.kind === 'available' && (
        <>
          <span style={labelBlue}>Update</span>
          <span style={text}>v{status.version} downloading…</span>
        </>
      )}
      {status.kind === 'downloading' && (
        <>
          <span style={labelBlue}>Update</span>
          <span style={text}>downloading {status.percent}%</span>
        </>
      )}
      {status.kind === 'ready' && (
        <>
          <span style={labelGreen}>Ready</span>
          <span style={text}>v{status.version}</span>
          <button style={btn} onClick={() => void window.desktop.update.install()}>
            Restart now
          </button>
        </>
      )}
      {status.kind === 'error' && (
        <>
          <span style={labelRed}>Update failed</span>
          <span style={{ ...text, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {status.message}
          </span>
        </>
      )}
      <button style={dismissBtn} onClick={() => setDismissed(true)} aria-label="Dismiss">×</button>
    </div>
  );
}

const wrap: React.CSSProperties = {
  position: 'fixed',
  left: 16,
  bottom: 16,
  zIndex: 45,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  background: '#161616',
  border: '1px solid #2A2A2A',
  color: '#fff',
  padding: '8px 12px',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 12,
  boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
};
const text: React.CSSProperties = { color: '#CCC' };
const labelBlue: React.CSSProperties = { color: '#2196F3', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 600 };
const labelGreen: React.CSSProperties = { color: '#4CAF50', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 600 };
const labelRed: React.CSSProperties = { color: '#F03535', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 600 };
const btn: React.CSSProperties = {
  background: '#D62B2B', border: 'none', color: '#fff',
  padding: '4px 10px', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 600, cursor: 'pointer',
};
const dismissBtn: React.CSSProperties = {
  background: 'transparent', border: 'none', color: '#888', cursor: 'pointer', fontSize: 16, padding: '0 4px',
};
