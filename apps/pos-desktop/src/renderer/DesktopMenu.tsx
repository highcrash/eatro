import React, { useEffect, useState } from 'react';

interface Props {
  onPrinters: () => void;
  onSync: () => void;
  onChangePin: () => void;
  onRequestUnpair: () => void;
  onSignOut: () => void;
  terminalName: string;
  cashierName: string;
  cashierRole: string;
}

/**
 * Floating bottom-right menu. Role gates in one place:
 *   - Printer Settings + Sync Status + Check for updates: OWNER only
 *   - Change PIN: everyone
 *   - Unpair: everyone (always asks for owner password in the next step)
 *   - Sign out: everyone
 */
export function DesktopMenu({
  onPrinters, onSync, onChangePin, onRequestUnpair, onSignOut,
  terminalName, cashierName, cashierRole,
}: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    void window.desktop.app.version().then((v) => setVersion(v.version));
  }, []);

  const isOwner = cashierRole === 'OWNER';

  const close = () => setOpen(false);

  return (
    <div style={wrap}>
      {open && (
        <div style={menu}>
          <div style={header}>
            <span style={headerSub}>Terminal</span>
            <span style={headerName}>{terminalName}</span>
            <span style={{ ...headerSub, marginTop: 8 }}>Signed in as</span>
            <span style={headerName}>{cashierName}</span>
            <span style={roleBadge}>{cashierRole}</span>
          </div>

          <button style={item} onClick={() => { close(); onChangePin(); }}>Change PIN</button>

          {isOwner && (
            <>
              <div style={divider} />
              <div style={sectionLabel}>Owner controls</div>
              <button style={item} onClick={() => { close(); onSync(); }}>Sync status</button>
              <button style={item} onClick={() => { close(); onPrinters(); }}>Printer settings</button>
              <button style={item} onClick={() => void window.desktop.update.check()}>Check for updates</button>
              <button style={itemDanger} onClick={() => { close(); onRequestUnpair(); }}>Unpair this terminal…</button>
            </>
          )}

          {!isOwner && (
            <>
              <div style={divider} />
              <p style={lockedNote}>Printer and sync settings are owner-only. Sign in as the owner to change them.</p>
            </>
          )}

          <div style={divider} />
          <button style={itemDanger} onClick={() => { close(); onSignOut(); }}>Sign out</button>

          {version && <div style={versionTag}>v{version}</div>}
        </div>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Desktop menu"
        style={fab}
      >
        <span style={fabIcon}>⋮</span>
      </button>
    </div>
  );
}

const wrap: React.CSSProperties = {
  position: 'fixed',
  right: 16,
  bottom: 16,
  zIndex: 40,
  fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
};
const fab: React.CSSProperties = {
  width: 48, height: 48,
  background: '#D62B2B', color: '#fff', border: 'none',
  cursor: 'pointer',
  boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
  fontSize: 22, fontWeight: 700,
};
const fabIcon: React.CSSProperties = { lineHeight: 1 };
const menu: React.CSSProperties = {
  position: 'absolute', bottom: 56, right: 0,
  minWidth: 260,
  background: '#161616', border: '1px solid #2A2A2A',
  boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  color: '#fff',
  display: 'flex', flexDirection: 'column',
};
const header: React.CSSProperties = {
  padding: '12px 14px', borderBottom: '1px solid #2A2A2A',
  display: 'flex', flexDirection: 'column', gap: 2,
};
const headerSub: React.CSSProperties = { color: '#666', fontSize: 9, letterSpacing: 3, textTransform: 'uppercase' };
const headerName: React.CSSProperties = { color: '#fff', fontSize: 13, fontWeight: 500 };
const roleBadge: React.CSSProperties = {
  alignSelf: 'flex-start',
  background: '#2A2A2A', color: '#D62B2B',
  fontSize: 9, letterSpacing: 3, textTransform: 'uppercase',
  padding: '2px 6px', marginTop: 6, fontWeight: 700,
};
const sectionLabel: React.CSSProperties = {
  padding: '6px 14px 2px', fontSize: 9, letterSpacing: 3,
  textTransform: 'uppercase', color: '#666',
};
const lockedNote: React.CSSProperties = {
  padding: '10px 14px', margin: 0,
  color: '#888', fontSize: 11, lineHeight: 1.5,
};
const item: React.CSSProperties = {
  background: 'transparent', border: 'none', color: '#CCC',
  padding: '10px 14px', textAlign: 'left', fontSize: 13,
  cursor: 'pointer', fontFamily: 'inherit',
};
const itemDanger: React.CSSProperties = { ...item, color: '#F03535' };
const divider: React.CSSProperties = { borderTop: '1px solid #2A2A2A' };
const versionTag: React.CSSProperties = {
  padding: '6px 14px', fontSize: 10, color: '#555',
  textAlign: 'right', letterSpacing: 1,
};
