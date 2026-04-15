import React, { useCallback, useEffect, useState } from 'react';
import type { FailedOutboxRow, SyncStatus } from './desktop-api';

interface Props { onClose: () => void }

/**
 * Sync Issues panel — surfaces outbox contents so the owner can retry or
 * dismiss rows that failed with hard (4xx) errors. Also includes a small
 * demo harness that lets you exercise the whole offline → online path
 * before the POS UI is hooked up in Phase 5.
 */
export function SyncPanel({ onClose }: Props): JSX.Element {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [failed, setFailed] = useState<FailedOutboxRow[] | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [s, f] = await Promise.all([
      window.desktop.sync.status(),
      window.desktop.sync.failedList(),
    ]);
    setStatus(s);
    setFailed(f);
  }, []);

  useEffect(() => {
    void refresh();
    const off = window.desktop.sync.onStatusChanged(() => void refresh());
    return off;
  }, [refresh]);

  const run = async (key: string, fn: () => Promise<void>, label: string) => {
    setBusyAction(key);
    setNote(null);
    try {
      await fn();
      setNote(label);
      await refresh();
      setTimeout(() => setNote(null), 2000);
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div>
          <p style={styles.kicker}>Terminal</p>
          <h1 style={styles.title}>SYNC STATUS</h1>
          <p style={styles.sub}>
            Monitor offline queue, retry failed requests, and force a connection probe.
          </p>
        </div>
        <button onClick={onClose} style={styles.btnClose}>Close</button>
      </header>

      <div style={styles.body}>
        <section style={styles.statusBlock}>
          <StatusCard
            label="Connection"
            value={status ? (status.online ? 'ONLINE' : status.rawStatus === 'offline' ? 'OFFLINE' : '…') : '…'}
            tone={status?.online ? 'good' : status?.rawStatus === 'offline' ? 'bad' : 'neutral'}
          />
          <StatusCard label="Queued" value={String(status?.pending ?? 0)} tone={status && status.pending > 0 ? 'warn' : 'neutral'} />
          <StatusCard label="Failed" value={String(status?.failed ?? 0)} tone={status && status.failed > 0 ? 'bad' : 'neutral'} />
        </section>

        <section style={styles.actions}>
          <button
            onClick={() => void run('probe', async () => { await window.desktop.sync.probe(); }, 'Probe complete')}
            disabled={busyAction !== null}
            style={styles.btnSecondary}
          >
            Probe server now
          </button>
          <button
            onClick={() => void run('drain', async () => { await window.desktop.sync.drainNow(); }, 'Drain run')}
            disabled={busyAction !== null}
            style={styles.btnPrimary}
          >
            Drain outbox now
          </button>
          <button
            onClick={() => void run('offline', async () => { await window.desktop.sync.forceOffline(); }, 'Forced offline — next probe will re-check')}
            disabled={busyAction !== null}
            style={styles.btnDanger}
          >
            Force offline (for testing)
          </button>
        </section>

        {note && <p style={styles.note}>{note}</p>}

        {/* Demo harness — lets you enqueue a fake mutation to exercise the flow
            before the POS UI is wired in Phase 5. */}
        <section style={styles.demoBlock}>
          <h2 style={styles.sectionTitle}>Demo harness</h2>
          <p style={styles.sub}>
            Fire a fake <code>POST /orders/ping</code> through the desktop API proxy. When offline
            it lands in the outbox; when online it calls the server (which returns 404, so you can
            verify the whole stack end-to-end).
          </p>
          <button
            onClick={() =>
              void run(
                'demo',
                async () => {
                  await window.desktop.api.fetch({
                    method: 'POST',
                    path: '/orders/ping',
                    body: { demo: true, at: new Date().toISOString() },
                  });
                },
                'Request dispatched',
              )
            }
            disabled={busyAction !== null}
            style={styles.btnSecondary}
          >
            Enqueue demo mutation
          </button>
        </section>

        <section>
          <h2 style={styles.sectionTitle}>Failed requests</h2>
          {failed === null ? (
            <p style={styles.sub}>Loading…</p>
          ) : failed.length === 0 ? (
            <p style={styles.sub}>No failed requests.</p>
          ) : (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>When</th>
                  <th style={styles.th}>Request</th>
                  <th style={styles.th}>Attempts</th>
                  <th style={styles.th}>Error</th>
                  <th style={styles.th}></th>
                </tr>
              </thead>
              <tbody>
                {failed.map((r) => (
                  <tr key={r.id}>
                    <td style={styles.td}>{new Date(r.createdAtMs).toLocaleTimeString()}</td>
                    <td style={styles.td}><code>{r.method} {r.path}</code></td>
                    <td style={styles.td}>{r.attempts}</td>
                    <td style={{ ...styles.td, color: '#F03535', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.lastError ?? ''}>
                      {r.lastError ?? ''}
                    </td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>
                      <button
                        onClick={() => void window.desktop.sync.retry(r.id).then(refresh)}
                        style={styles.tinyBtn}
                      >
                        Retry
                      </button>
                      <button
                        onClick={() => void window.desktop.sync.dismiss(r.id).then(refresh)}
                        style={styles.tinyBtnGhost}
                      >
                        Dismiss
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}

function StatusCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'good' | 'bad' | 'warn' | 'neutral';
}): JSX.Element {
  const color = tone === 'good' ? '#4CAF50' : tone === 'bad' ? '#F03535' : tone === 'warn' ? '#F5B324' : '#888';
  return (
    <div style={{ ...styles.statusCard, borderColor: color }}>
      <span style={styles.statusLabel}>{label}</span>
      <span style={{ ...styles.statusValue, color }}>{value}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { height: '100%', minHeight: 0, background: '#0D0D0D', color: '#fff', fontFamily: 'system-ui, sans-serif', display: 'flex', flexDirection: 'column' },
  header: { padding: '24px 32px', borderBottom: '1px solid #2A2A2A', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  kicker: { color: '#D62B2B', fontSize: 11, letterSpacing: 4, textTransform: 'uppercase', margin: 0 },
  title: { fontSize: 30, letterSpacing: 3, margin: '4px 0' },
  sub: { color: '#999', fontSize: 13, margin: 0, lineHeight: 1.6 },
  btnClose: { background: 'transparent', border: '1px solid #2A2A2A', color: '#999', padding: '10px 18px', fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', cursor: 'pointer' },
  body: { flex: 1, minHeight: 0, overflow: 'auto', padding: 32, display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 960, width: '100%', alignSelf: 'center' },

  statusBlock: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 },
  statusCard: { background: '#161616', border: '2px solid #2A2A2A', padding: 18, display: 'flex', flexDirection: 'column', gap: 6 },
  statusLabel: { color: '#888', fontSize: 10, letterSpacing: 3, textTransform: 'uppercase' },
  statusValue: { fontSize: 26, fontWeight: 700, letterSpacing: 2 },

  actions: { display: 'flex', gap: 10, flexWrap: 'wrap' },
  btnSecondary: { background: 'transparent', border: '1px solid #2A2A2A', color: '#fff', padding: '10px 16px', fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'inherit' },
  btnPrimary: { background: '#D62B2B', border: 'none', color: '#fff', padding: '10px 16px', fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 },
  btnDanger: { background: 'transparent', border: '1px solid #7A2A2A', color: '#F03535', padding: '10px 16px', fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'inherit' },

  note: { color: '#888', fontSize: 12, margin: 0 },

  demoBlock: { background: '#161616', border: '1px solid #2A2A2A', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 },
  sectionTitle: { fontSize: 14, letterSpacing: 3, textTransform: 'uppercase', color: '#CCC', margin: 0 },

  table: { width: '100%', borderCollapse: 'collapse', background: '#161616', border: '1px solid #2A2A2A' },
  th: { textAlign: 'left', padding: '10px 12px', fontSize: 10, letterSpacing: 3, textTransform: 'uppercase', color: '#666', borderBottom: '1px solid #2A2A2A' },
  td: { padding: '8px 12px', fontSize: 12, borderBottom: '1px solid #1F1F1F', color: '#CCC' },
  tinyBtn: { background: '#D62B2B', border: 'none', color: '#fff', padding: '4px 10px', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer', fontWeight: 600, marginRight: 6 },
  tinyBtnGhost: { background: 'transparent', border: '1px solid #2A2A2A', color: '#888', padding: '4px 10px', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer' },
};
