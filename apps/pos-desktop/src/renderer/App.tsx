import React, { useEffect, useState } from 'react';
import { FirstRunSetup } from './FirstRunSetup';
import { LockScreen } from './LockScreen';
import { PrinterSettings } from './PrinterSettings';
import { SyncBanner } from './SyncBanner';
import { SyncPanel } from './SyncPanel';
import { PosEmbed } from './PosEmbed';
import { DesktopMenu } from './DesktopMenu';
import { UpdateToast } from './UpdateToast';
import type { PairedConfig, SessionUser } from './desktop-api';

type View = 'loading' | 'pairing' | 'locked' | 'signed-in' | 'printer-settings' | 'sync-panel';

export function App(): JSX.Element {
  const [view, setView] = useState<View>('loading');
  const [config, setConfig] = useState<PairedConfig | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    void (async () => {
      const cfg = await window.desktop.config.get();
      if (!cfg) {
        setView('pairing');
        return;
      }
      setConfig(cfg);
      setView('locked');
    })();
  }, []);

  async function unpair() {
    await window.desktop.device.unpair();
    setConfig(null);
    setUser(null);
    setView('pairing');
  }

  async function signOut() {
    await window.desktop.session.signout();
    setUser(null);
    setView('locked');
  }

  if (view === 'loading') return <CenterText>Loading…</CenterText>;

  if (view === 'pairing') {
    return (
      <FirstRunSetup
        onPaired={(cfg) => {
          setConfig(cfg);
          setView('locked');
        }}
      />
    );
  }

  if (view === 'locked' && config) {
    return (
      <LockScreen
        deviceName={config.deviceName}
        branchName={config.branch.name}
        onUnpair={() => void unpair()}
        onSignedIn={(u) => {
          setUser(u);
          setView('signed-in');
        }}
      />
    );
  }

  if (view === 'printer-settings') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <SyncBanner />
        <div style={{ flex: 1, minHeight: 0 }}>
          <PrinterSettings onClose={() => setView('signed-in')} />
        </div>
      </div>
    );
  }

  if (view === 'sync-panel') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <SyncBanner />
        <div style={{ flex: 1, minHeight: 0 }}>
          <SyncPanel onClose={() => setView('signed-in')} />
        </div>
      </div>
    );
  }

  if (view === 'signed-in' && user && config) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <SyncBanner />
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <PosEmbed user={user} onSignOutRequested={() => void signOut()} />
        </div>
        <DesktopMenu
          terminalName={config.deviceName}
          cashierName={user.name}
          onPrinters={() => setView('printer-settings')}
          onSync={() => setView('sync-panel')}
          onSignOut={() => void signOut()}
        />
        <UpdateToast />
      </div>
    );
  }

  return <CenterText>…</CenterText>;
}

function CenterText({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0D0D0D',
        color: '#888',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {children}
    </div>
  );
}

