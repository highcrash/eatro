import React from 'react';

interface State { error: Error | null }

/**
 * Catches uncaught render errors inside the embedded POS tree so the
 * whole Electron window doesn't blank out when the network drops mid-render
 * and a component throws on undefined data.
 *
 * Recovery is one click — we just clear the error and let React try
 * rendering again. By that time React Query will likely have refetched and
 * the api-proxy will serve cached data.
 */
export class OfflineErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[OfflineErrorBoundary] caught:', error, info);
  }

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children;

    const isOffline = !navigator.onLine;

    return (
      <div style={page}>
        <div style={card}>
          <p style={kicker}>{isOffline ? 'Offline' : 'Page error'}</p>
          <h1 style={title}>{isOffline ? "We're offline" : 'Something broke'}</h1>
          <p style={sub}>
            {isOffline
              ? "The terminal can't reach the server right now. Existing orders, menu, and tables stay usable while we wait — the screen will retry once we're back online."
              : 'A page in the POS hit an unexpected error. The desktop wrapper is still healthy.'}
          </p>
          <pre style={detail}>{this.state.error.message}</pre>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            style={btn}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }
}

const page: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#0D0D0D',
  color: '#fff',
  fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
  padding: 24,
};
const card: React.CSSProperties = {
  width: '100%',
  maxWidth: 520,
  background: '#161616',
  border: '1px solid #2A2A2A',
  padding: 32,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  textAlign: 'center',
};
const kicker: React.CSSProperties = { color: '#D62B2B', fontSize: 11, letterSpacing: 4, textTransform: 'uppercase', margin: 0 };
const title: React.CSSProperties = { fontSize: 32, letterSpacing: 3, margin: '4px 0 8px' };
const sub: React.CSSProperties = { color: '#999', fontSize: 14, lineHeight: 1.5, margin: '0 0 4px' };
const detail: React.CSSProperties = {
  fontFamily: 'Consolas, Menlo, monospace',
  fontSize: 11,
  color: '#666',
  background: '#0D0D0D',
  border: '1px solid #2A2A2A',
  padding: 10,
  margin: '8px 0 12px',
  textAlign: 'left',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  maxHeight: 140,
  overflow: 'auto',
};
const btn: React.CSSProperties = {
  background: '#D62B2B',
  color: '#fff',
  border: 'none',
  padding: '12px 20px',
  fontSize: 12,
  letterSpacing: 3,
  textTransform: 'uppercase',
  fontWeight: 700,
  cursor: 'pointer',
};
