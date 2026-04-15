import React, { useEffect, useState } from 'react';
import type { DiagnosticsSnapshot } from './desktop-api';

/**
 * Read-only snapshot of every moving part of the terminal for support. The
 * owner pulls this up from the sidebar, screenshots it, and shares it when
 * something's off — covers connection health, outbox, pairing, printers,
 * auto-update, and local SQLite sizes in one place.
 *
 * Auto-refreshes every 2s so a live incident can be watched in real time.
 * "Copy JSON" dumps the raw snapshot to the clipboard for paste-into-chat.
 */

interface Props {
  onClose: () => void;
}

export function DiagnosticsPanel({ onClose }: Props): JSX.Element {
  const [snap, setSnap] = useState<DiagnosticsSnapshot | null>(null);
  const [copied, setCopied] = useState(false);
  const [testing, setTesting] = useState<'kitchen' | 'bill' | 'reports' | 'drawer' | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function pull() {
      try {
        const s = await window.desktop.diagnostics.snapshot();
        if (alive) setSnap(s);
      } catch (err) {
        console.error('[diagnostics] snapshot failed:', err);
      }
    }
    void pull();
    const i = setInterval(() => void pull(), 2000);
    return () => { alive = false; clearInterval(i); };
  }, []);

  async function copyJson() {
    if (!snap) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(snap, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  async function runPrinterTest(slot: 'kitchen' | 'bill' | 'reports') {
    setTesting(slot);
    setTestResult(null);
    const r = await window.desktop.printers.test(slot);
    setTesting(null);
    setTestResult(r.ok ? `${slot} test fired` : `${slot} failed: ${r.message}`);
  }

  async function kickDrawer() {
    setTesting('drawer');
    setTestResult(null);
    const r = await window.desktop.printers.openCashDrawer();
    setTesting(null);
    setTestResult(r.ok ? 'drawer pulse sent' : `drawer failed: ${r.message}`);
  }

  async function forceProbe() {
    await window.desktop.sync.probe();
    const s = await window.desktop.diagnostics.snapshot();
    setSnap(s);
  }

  async function drainNow() {
    const r = await window.desktop.sync.drainNow();
    setTestResult(`drain: ${r.drained} drained, ${r.failed} failed, ${r.remaining} remaining`);
    const s = await window.desktop.diagnostics.snapshot();
    setSnap(s);
  }

  if (!snap) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <p style={{ color: '#888' }}>Loading diagnostics…</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div>
          <p style={styles.kicker}>Terminal</p>
          <h1 style={styles.title}>DIAGNOSTICS</h1>
          <p style={styles.sub}>captured {new Date(snap.capturedAt).toLocaleTimeString()}</p>
        </div>
        <div style={styles.headerBtns}>
          <button onClick={() => void copyJson()} style={styles.btnSecondary}>
            {copied ? 'Copied' : 'Copy JSON'}
          </button>
          <button onClick={onClose} style={styles.btnClose}>Close</button>
        </div>
      </header>

      {testResult && <div style={styles.banner}>{testResult}</div>}

      <div style={styles.grid}>
        <Section title="App">
          <Row k="Version" v={`${snap.app.version}${snap.app.isPackaged ? '' : ' (dev)'}`} />
          <Row k="Commit" v={snap.app.commitSha ?? '—'} mono />
          <Row k="Platform" v={snap.app.platform} />
          <Row k="Electron" v={snap.app.electron} />
          <Row k="Node" v={snap.app.node} />
        </Section>

        <Section title="Signed in">
          {snap.session.user ? (
            <>
              <Row k="Name" v={snap.session.user.name} />
              <Row k="Role" v={snap.session.user.role} />
              <Row k="Email" v={snap.session.user.email} />
              <Row k="Branch" v={snap.session.user.branchName} />
            </>
          ) : (
            <Row k="Status" v="No cashier signed in" dim />
          )}
        </Section>

        <Section title="Pairing">
          {snap.pairing.paired ? (
            <>
              <Row k="Server" v={snap.pairing.serverUrl ?? '—'} mono />
              <Row k="Branch" v={snap.pairing.branchName ?? '—'} />
              <Row k="Device" v={snap.pairing.deviceName ?? '—'} />
              <Row k="Device ID" v={snap.pairing.deviceId ?? '—'} mono />
              <Row k="Paired at" v={snap.pairing.pairedAt ? new Date(snap.pairing.pairedAt).toLocaleString() : '—'} />
            </>
          ) : (
            <Row k="Status" v="Terminal is not paired" dim />
          )}
        </Section>

        <Section
          title="Connection"
          actions={<button onClick={() => void forceProbe()} style={styles.btnLink}>Probe now</button>}
        >
          <Row
            k="Status"
            v={snap.online.status.toUpperCase()}
            accent={snap.online.isOnline ? '#2DB36A' : snap.online.status === 'offline' ? '#D62B2B' : '#999'}
          />
          <Row k="Last probe" v={snap.online.lastProbeAtMs ? `${Math.round((Date.now() - snap.online.lastProbeAtMs) / 1000)}s ago` : 'never'} />
          <Row k="Latency" v={snap.online.lastProbeLatencyMs != null ? `${snap.online.lastProbeLatencyMs} ms` : '—'} />
          <Row k="Consecutive fails" v={String(snap.online.consecutiveFails)} />
          <Row k="Last error" v={snap.online.lastError ?? '—'} mono dim={snap.online.lastError == null} />
        </Section>

        <Section
          title="Outbox"
          actions={<button onClick={() => void drainNow()} style={styles.btnLink}>Drain now</button>}
        >
          <Row k="Pending" v={String(snap.outbox.pending)} accent={snap.outbox.pending > 0 ? '#E0A33A' : undefined} />
          <Row k="Failed" v={String(snap.outbox.failed)} accent={snap.outbox.failed > 0 ? '#D62B2B' : undefined} />
          <Row
            k="Oldest pending"
            v={snap.outbox.oldestPendingAtMs ? `${Math.round((Date.now() - snap.outbox.oldestPendingAtMs) / 1000)}s ago` : '—'}
          />
          {snap.outbox.failedSamples.length > 0 && (
            <div style={styles.failedList}>
              {snap.outbox.failedSamples.map((f) => (
                <div key={f.id} style={styles.failedRow}>
                  <div style={styles.failedMeta}>
                    <span style={styles.failedMethod}>{f.method}</span>
                    <span style={styles.failedPath}>{f.path}</span>
                    <span style={styles.failedAttempts}>×{f.attempts}</span>
                  </div>
                  {f.lastError && <div style={styles.failedError}>{f.lastError}</div>}
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Printers">
          <PrinterRow
            label="Kitchen"
            slot={snap.printers.kitchen}
            busy={testing === 'kitchen'}
            onTest={() => void runPrinterTest('kitchen')}
          />
          <PrinterRow
            label="Bill"
            slot={snap.printers.bill}
            busy={testing === 'bill'}
            onTest={() => void runPrinterTest('bill')}
          />
          <PrinterRow
            label="Reports"
            slot={snap.printers.reports}
            busy={testing === 'reports'}
            onTest={() => void runPrinterTest('reports')}
          />
          <Row
            k="Drawer on cash"
            v={snap.printers.openCashDrawerOnCashPayment ? 'Enabled' : 'Disabled'}
            actions={<button disabled={testing === 'drawer'} onClick={() => void kickDrawer()} style={styles.btnLinkSmall}>{testing === 'drawer' ? '…' : 'Kick'}</button>}
          />
        </Section>

        <Section title="Local database">
          <Row k="Path" v={snap.localDb.pathHint} mono />
          {snap.localDb.tables.map((t) => (
            <Row key={t.name} k={t.name} v={`${t.rows.toLocaleString()} row${t.rows === 1 ? '' : 's'}`} mono />
          ))}
        </Section>

        <Section title="Logs">
          <Row k="Main log" v={snap.logs.mainLogPath} mono />
        </Section>

        <Section title="Auto-update">
          <Row k="State" v={describeUpdate(snap.update)} />
        </Section>
      </div>
    </div>
  );
}

function describeUpdate(u: DiagnosticsSnapshot['update']): string {
  switch (u.kind) {
    case 'idle': return 'Idle';
    case 'checking': return 'Checking…';
    case 'none': return `Up to date (v${u.currentVersion})`;
    case 'available': return `Available: v${u.version}`;
    case 'downloading': return `Downloading ${u.percent}%`;
    case 'ready': return `Ready to install v${u.version}`;
    case 'error': return `Error: ${u.message}`;
  }
}

/* ── structural bits ──────────────────────────────────────────────────────── */

function Section({
  title, children, actions,
}: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section style={styles.section}>
      <div style={styles.sectionHeader}>
        <span style={styles.sectionTitle}>{title}</span>
        {actions}
      </div>
      <div style={styles.sectionBody}>{children}</div>
    </section>
  );
}

function PrinterRow({
  label, slot, busy, onTest,
}: {
  label: string;
  slot: DiagnosticsSnapshot['printers']['kitchen'];
  busy: boolean;
  onTest: () => void;
}) {
  const color = slot.health === 'online' ? '#2DB36A' : slot.health === 'unreachable' ? '#D62B2B' : '#666';
  const latency = slot.latencyMs != null ? ` · ${slot.latencyMs}ms` : '';
  const hint = slot.lastError ?? (slot.health === 'online' ? 'Reachable' : 'Status unknown');
  return (
    <div style={styles.row}>
      <span style={styles.rowKey}>{label}</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flex: 1 }} title={hint}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
        <span style={{ ...styles.rowValue, flex: 'unset' }}>{slot.label}{latency}</span>
      </span>
      <button disabled={busy} onClick={onTest} style={styles.btnLinkSmall}>
        {busy ? '…' : 'Test'}
      </button>
    </div>
  );
}

function Row({
  k, v, mono, dim, accent, actions,
}: {
  k: string;
  v: string;
  mono?: boolean;
  dim?: boolean;
  accent?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div style={styles.row}>
      <span style={styles.rowKey}>{k}</span>
      <span
        style={{
          ...styles.rowValue,
          ...(mono ? styles.mono : {}),
          ...(dim ? { color: '#555' } : {}),
          ...(accent ? { color: accent } : {}),
        }}
      >
        {v}
      </span>
      {actions}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#0D0D0D',
    color: '#fff',
    fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
    padding: 24,
    overflow: 'auto',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 16,
    maxWidth: 1200,
    margin: '0 auto 20px',
  },
  kicker: { color: '#D62B2B', fontSize: 10, letterSpacing: 4, textTransform: 'uppercase', margin: 0 },
  title: { fontSize: 28, letterSpacing: 4, margin: '4px 0 2px' },
  sub: { color: '#666', fontSize: 11, margin: 0, letterSpacing: 2, textTransform: 'uppercase' },
  headerBtns: { display: 'flex', gap: 8 },
  banner: {
    maxWidth: 1200,
    margin: '0 auto 16px',
    background: '#161616',
    border: '1px solid #2A2A2A',
    color: '#ccc',
    padding: '8px 14px',
    fontSize: 12,
  },
  grid: {
    maxWidth: 1200,
    margin: '0 auto',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
    gap: 12,
  },
  card: { maxWidth: 600, margin: '80px auto', background: '#161616', padding: 24, border: '1px solid #2A2A2A' },
  section: {
    background: '#161616',
    border: '1px solid #2A2A2A',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 14px',
    borderBottom: '1px solid #2A2A2A',
    background: '#1A1A1A',
  },
  sectionTitle: { fontSize: 10, letterSpacing: 3, textTransform: 'uppercase', color: '#888', fontWeight: 700 },
  sectionBody: { padding: '6px 14px 10px' },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '6px 0',
    borderBottom: '1px solid #1C1C1C',
  },
  rowKey: { flex: '0 0 120px', color: '#888', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' },
  rowValue: { flex: 1, color: '#eee', fontSize: 13, wordBreak: 'break-all' },
  mono: { fontFamily: 'Consolas, Menlo, monospace', fontSize: 12 },
  btnSecondary: {
    background: 'transparent',
    border: '1px solid #2A2A2A',
    color: '#ccc',
    padding: '8px 14px',
    fontSize: 11,
    letterSpacing: 2,
    textTransform: 'uppercase',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  btnClose: {
    background: '#D62B2B',
    border: 'none',
    color: '#fff',
    padding: '8px 18px',
    fontSize: 11,
    letterSpacing: 2,
    textTransform: 'uppercase',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontWeight: 600,
  },
  btnLink: {
    background: 'transparent',
    border: 'none',
    color: '#D62B2B',
    fontSize: 10,
    letterSpacing: 2,
    textTransform: 'uppercase',
    cursor: 'pointer',
    padding: 0,
    fontFamily: 'inherit',
    fontWeight: 600,
  },
  btnLinkSmall: {
    background: 'transparent',
    border: '1px solid #2A2A2A',
    color: '#ccc',
    fontSize: 9,
    letterSpacing: 2,
    textTransform: 'uppercase',
    cursor: 'pointer',
    padding: '3px 8px',
    fontFamily: 'inherit',
  },
  failedList: { marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 },
  failedRow: { background: '#0D0D0D', border: '1px solid #2A2A2A', padding: 8 },
  failedMeta: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 11 },
  failedMethod: { color: '#E0A33A', fontFamily: 'Consolas, Menlo, monospace', fontWeight: 600 },
  failedPath: { color: '#ccc', fontFamily: 'Consolas, Menlo, monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' },
  failedAttempts: { color: '#666', fontSize: 10 },
  failedError: { marginTop: 4, color: '#D62B2B', fontSize: 11, fontFamily: 'Consolas, Menlo, monospace' },
};
