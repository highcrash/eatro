import React, { useEffect, useState } from 'react';
import type { OsPrinter, PrinterSlot, PrintersConfig } from './desktop-api';

interface Props {
  onClose: () => void;
}

type SlotKey = 'kitchen' | 'bill' | 'reports';

const SLOT_META: Record<SlotKey, { title: string; subtitle: string; allowNetwork: boolean; allowOs: boolean }> = {
  kitchen: {
    title: 'Kitchen Ticket (KOT)',
    subtitle: '80 mm thermal — sent the moment an order is fired',
    allowNetwork: true,
    allowOs: true,
  },
  bill: {
    title: 'Bill / Receipt',
    subtitle: '80 mm thermal — cash drawer pops on cash payment (network mode only)',
    allowNetwork: true,
    allowOs: true,
  },
  reports: {
    title: 'Reports (A4)',
    subtitle: 'Daily / Sales / Expense reports. OS-installed printer only.',
    allowNetwork: false,
    allowOs: true,
  },
};

export function PrinterSettings({ onClose }: Props): JSX.Element {
  const [config, setConfig] = useState<PrintersConfig | null>(null);
  const [osPrinters, setOsPrinters] = useState<OsPrinter[]>([]);
  const [busy, setBusy] = useState(false);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [testNote, setTestNote] = useState<{ slot: SlotKey; ok: boolean; message?: string } | null>(null);

  useEffect(() => {
    void (async () => {
      const [cfg, printers] = await Promise.all([
        window.desktop.printers.get(),
        window.desktop.printers.listOs(),
      ]);
      setConfig(cfg);
      setOsPrinters(printers);
    })();
  }, []);

  if (!config) {
    return (
      <div style={styles.page}>
        <p style={{ color: '#888' }}>Loading printer settings…</p>
      </div>
    );
  }

  const updateSlot = (slot: SlotKey, next: PrinterSlot) => {
    setConfig({ ...config, [slot]: next });
    setSaveNote(null);
    setTestNote(null);
  };

  const save = async () => {
    setBusy(true);
    setSaveNote(null);
    try {
      const saved = await window.desktop.printers.set(config);
      setConfig(saved);
      setSaveNote('Saved.');
      setTimeout(() => setSaveNote(null), 1500);
    } catch (err) {
      setSaveNote(`Save failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const test = async (slot: SlotKey) => {
    setTestNote(null);
    const result = await window.desktop.printers.test(slot);
    setTestNote({ slot, ok: result.ok, message: result.ok ? undefined : result.message });
  };

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div>
          <p style={styles.kicker}>Terminal settings</p>
          <h1 style={styles.title}>PRINTERS</h1>
          <p style={styles.sub}>Configure up to three printers wired to this cashier PC.</p>
        </div>
        <button onClick={onClose} style={styles.btnClose}>Close</button>
      </header>

      <div style={styles.body}>
        {(Object.keys(SLOT_META) as SlotKey[]).map((slot) => (
          <SlotCard
            key={slot}
            slot={slot}
            meta={SLOT_META[slot]}
            value={config[slot]}
            osPrinters={osPrinters}
            onChange={(next) => updateSlot(slot, next)}
            onTest={() => void test(slot)}
            testResult={testNote?.slot === slot ? testNote : null}
          />
        ))}

        <div style={styles.toggleRow}>
          <label style={styles.toggle}>
            <input
              type="checkbox"
              checked={config.openCashDrawerOnCashPayment}
              onChange={(e) => {
                setConfig({ ...config, openCashDrawerOnCashPayment: e.target.checked });
                setSaveNote(null);
              }}
            />
            <span>Open cash drawer on cash payment</span>
          </label>
          <span style={styles.hint}>
            Requires the bill printer to be in <strong>network</strong> mode. Drawer kick is sent as part of the receipt print.
          </span>
        </div>
      </div>

      <footer style={styles.footer}>
        {saveNote && <span style={styles.saveNote}>{saveNote}</span>}
        <button onClick={() => void save()} disabled={busy} style={styles.btnSave}>
          {busy ? 'Saving…' : 'Save printer settings'}
        </button>
      </footer>
    </div>
  );
}

/* ── slot card ──────────────────────────────────────────────────────── */

function SlotCard(props: {
  slot: SlotKey;
  meta: typeof SLOT_META[SlotKey];
  value: PrinterSlot;
  osPrinters: OsPrinter[];
  onChange: (next: PrinterSlot) => void;
  onTest: () => void;
  testResult: { ok: boolean; message?: string } | null;
}): JSX.Element {
  const { slot, meta, value, osPrinters, onChange, onTest, testResult } = props;

  return (
    <section style={styles.slotCard}>
      <div style={styles.slotHeader}>
        <div>
          <h2 style={styles.slotTitle}>{meta.title}</h2>
          <p style={styles.slotSub}>{meta.subtitle}</p>
        </div>
        <button onClick={onTest} disabled={value.mode === 'disabled'} style={styles.btnTest}>
          Test print
        </button>
      </div>

      <div style={styles.modeRow}>
        <ModeRadio
          label="Off"
          hint="No printing to this slot"
          selected={value.mode === 'disabled'}
          onSelect={() => onChange({ mode: 'disabled' })}
        />
        {meta.allowNetwork && (
          <ModeRadio
            label="Network (IP)"
            hint="ESC/POS over TCP to a LAN thermal printer"
            selected={value.mode === 'network'}
            onSelect={() =>
              onChange(
                value.mode === 'network'
                  ? value
                  : { mode: 'network', host: '', port: 9100 },
              )
            }
          />
        )}
        {meta.allowOs && (
          <ModeRadio
            label="OS printer"
            hint="Any printer installed on this Windows PC"
            selected={value.mode === 'os-printer'}
            onSelect={() =>
              onChange(
                value.mode === 'os-printer'
                  ? value
                  : { mode: 'os-printer', deviceName: osPrinters[0]?.name ?? '' },
              )
            }
          />
        )}
      </div>

      {value.mode === 'network' && (
        <div style={styles.formRow}>
          <label style={styles.fieldLabel}>
            Host / IP
            <input
              type="text"
              value={value.host}
              placeholder="192.168.1.50"
              onChange={(e) => onChange({ ...value, host: e.target.value.trim() })}
              style={styles.input}
            />
          </label>
          <label style={styles.fieldLabel}>
            Port
            <input
              type="number"
              value={value.port}
              onChange={(e) => onChange({ ...value, port: Math.max(1, Number(e.target.value) || 9100) })}
              style={styles.input}
            />
          </label>
        </div>
      )}

      {value.mode === 'os-printer' && (
        <div style={styles.formRow}>
          <label style={{ ...styles.fieldLabel, flex: 1 }}>
            Windows printer
            <select
              value={value.deviceName}
              onChange={(e) => onChange({ ...value, deviceName: e.target.value })}
              style={styles.input}
            >
              {osPrinters.length === 0 && <option value="">No printers found</option>}
              {osPrinters.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                  {p.isDefault ? ' (default)' : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {testResult && (
        <p style={testResult.ok ? styles.testOk : styles.testErr}>
          {testResult.ok ? 'Test sent to printer.' : `Test failed: ${testResult.message}`}
        </p>
      )}
    </section>
  );
}

function ModeRadio({
  label,
  hint,
  selected,
  onSelect,
}: {
  label: string;
  hint: string;
  selected: boolean;
  onSelect: () => void;
}): JSX.Element {
  return (
    <button
      onClick={onSelect}
      style={{
        ...styles.modeBtn,
        borderColor: selected ? '#D62B2B' : '#2A2A2A',
        background: selected ? '#1F0B0B' : '#0D0D0D',
      }}
    >
      <span style={{ fontWeight: 600, fontSize: 13 }}>{label}</span>
      <span style={{ fontSize: 11, color: '#888' }}>{hint}</span>
    </button>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    height: '100%',
    minHeight: 0,
    background: '#0D0D0D',
    color: '#fff',
    fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    padding: '24px 32px',
    borderBottom: '1px solid #2A2A2A',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  kicker: { color: '#D62B2B', fontSize: 11, letterSpacing: 4, textTransform: 'uppercase', margin: 0 },
  title: { fontSize: 30, letterSpacing: 3, margin: '4px 0' },
  sub: { color: '#999', fontSize: 13, margin: 0 },
  btnClose: {
    background: 'transparent',
    border: '1px solid #2A2A2A',
    color: '#999',
    padding: '10px 18px',
    fontSize: 11,
    letterSpacing: 3,
    textTransform: 'uppercase',
    cursor: 'pointer',
  },
  body: {
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
    padding: 32,
    display: 'flex',
    flexDirection: 'column',
    gap: 24,
    maxWidth: 900,
    width: '100%',
    alignSelf: 'center',
  },
  slotCard: {
    background: '#161616',
    border: '1px solid #2A2A2A',
    padding: 20,
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  slotHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  slotTitle: { margin: 0, fontSize: 18, letterSpacing: 1 },
  slotSub: { margin: '2px 0 0', fontSize: 12, color: '#888' },
  btnTest: {
    background: '#D62B2B',
    border: 'none',
    color: '#fff',
    padding: '8px 16px',
    fontSize: 10,
    letterSpacing: 3,
    textTransform: 'uppercase',
    cursor: 'pointer',
    fontWeight: 600,
    flexShrink: 0,
  },
  modeRow: { display: 'flex', gap: 10, flexWrap: 'wrap' },
  modeBtn: {
    flex: '1 1 180px',
    padding: '10px 14px',
    border: '1px solid #2A2A2A',
    color: '#fff',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 4,
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left',
  },
  formRow: { display: 'flex', gap: 12, flexWrap: 'wrap' },
  fieldLabel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    fontSize: 10,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: '#666',
  },
  input: {
    background: '#0D0D0D',
    border: '1px solid #2A2A2A',
    color: '#fff',
    padding: '8px 12px',
    fontSize: 14,
    fontFamily: 'inherit',
    outline: 'none',
    minWidth: 200,
  },
  testOk: { color: '#4CAF50', fontSize: 12 },
  testErr: { color: '#F03535', fontSize: 12, wordBreak: 'break-word' },
  toggleRow: {
    background: '#161616',
    border: '1px solid #2A2A2A',
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  toggle: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, cursor: 'pointer' },
  hint: { fontSize: 12, color: '#888' },
  footer: {
    padding: '16px 32px',
    borderTop: '1px solid #2A2A2A',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 16,
  },
  saveNote: { fontSize: 12, color: '#4CAF50' },
  btnSave: {
    background: '#D62B2B',
    border: 'none',
    color: '#fff',
    padding: '10px 20px',
    fontSize: 11,
    letterSpacing: 3,
    textTransform: 'uppercase',
    cursor: 'pointer',
    fontWeight: 600,
  },
};
