import React, { useEffect, useState } from 'react';
import { FirstRunSetup } from './FirstRunSetup';
import { LockScreen } from './LockScreen';
import { PrinterSettings } from './PrinterSettings';
import { SyncBanner } from './SyncBanner';
import { SyncPanel } from './SyncPanel';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { RevokedScreen } from './RevokedScreen';
import { LicenseStep } from './LicenseStep';
import { LicenseRequiredScreen } from './LicenseRequiredScreen';
import { PosEmbed } from './PosEmbed';
import { UpdateToast } from './UpdateToast';
import { ChangePinDialog } from './ChangePinDialog';
import { OwnerPasswordDialog } from './OwnerPasswordDialog';
import type { PairedConfig, SessionUser } from './desktop-api';
import type { LicenseVerdict } from '../preload/index';

type View = 'loading' | 'license' | 'pairing' | 'locked' | 'signed-in' | 'printer-settings' | 'sync-panel' | 'diagnostics';

export function App(): JSX.Element {
  const [view, setView] = useState<View>('loading');
  const [config, setConfig] = useState<PairedConfig | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [appVersion, setAppVersion] = useState<string>('0.0.0');
  const [changePinOpen, setChangePinOpen] = useState(false);
  const [unpairPromptOpen, setUnpairPromptOpen] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const [license, setLicense] = useState<LicenseVerdict | null>(null);

  useEffect(() => {
    void (async () => {
      const [cfg, ver, alreadyRevoked, lic] = await Promise.all([
        window.desktop.config.get(),
        window.desktop.app.version(),
        window.desktop.deviceStatus.isRevoked(),
        window.desktop.license.status(),
      ]);
      setAppVersion(ver.version);
      if (alreadyRevoked) setRevoked(true);
      setLicense(lic);
      // License gates everything. mode=missing → activation step; mode=locked
      // (REVOKED / EXPIRED / grace blown) → LicenseRequiredScreen overlays.
      if (lic.mode === 'missing') {
        setView('license');
        return;
      }
      if (!cfg) {
        setView('pairing');
        return;
      }
      setConfig(cfg);
      setView('locked');
    })();
  }, []);

  // Listen for the server telling us this terminal has been revoked — drops
  // the cashier straight into the hard lock, regardless of current view.
  useEffect(() => {
    return window.desktop.deviceStatus.onRevoked(() => setRevoked(true));
  }, []);

  // Listen for license verdict transitions pushed by the hourly verifier
  // in the main process. A flip to locked / missing immediately swaps the
  // cashier into the LicenseRequiredScreen — no waiting for a status poll.
  useEffect(() => {
    return window.desktop.license.onVerdictChanged((mode) => {
      void window.desktop.license.status().then(setLicense);
      // Only the takeover screens care about the mode flip; if we end
      // up active again, the existing view stays.
      if (mode === 'missing') setView('license');
    });
  }, []);

  async function unpair() {
    await window.desktop.device.unpair();
    setConfig(null);
    setUser(null);
    setView('pairing');
  }

  async function signOut() {
    // Mark the upcoming clearAuth as intentional so PosEmbed doesn't re-seed.
    (window as unknown as { __desktopMarkSignOut?: () => void }).__desktopMarkSignOut?.();
    await window.desktop.session.signout();
    setUser(null);
    setView('locked');
  }

  if (view === 'loading') return <CenterText>Loading…</CenterText>;

  // License takeover takes priority over EVERYTHING else (incl. revoked
  // device + first-run pairing). Without an active license the desktop
  // is read-only at the API layer; the UI mirrors that boundary so the
  // cashier knows what to do instead of seeing confusing 403s.
  if (view === 'license' || (license && license.mode === 'missing')) {
    return (
      <LicenseStep
        onActivated={(v) => {
          setLicense(v);
          // After activation, fall back into the original boot decision:
          // paired → locked, unpaired → pairing.
          if (config) {
            setView('locked');
          } else {
            setView('pairing');
          }
        }}
      />
    );
  }
  if (license && license.mode === 'locked') {
    return (
      <LicenseRequiredScreen
        verdict={license}
        onRecovered={(v) => {
          setLicense(v);
          if (v.mode === 'missing') {
            setView('license');
          } else if (config) {
            setView('locked');
          } else {
            setView('pairing');
          }
        }}
      />
    );
  }

  // Revoked takes priority over every other state — the terminal's token is
  // no longer valid so the cashier cannot do anything until the owner
  // unpairs + re-pairs.
  if (revoked && config) {
    return (
      <RevokedScreen
        branchName={config.branch.name}
        deviceName={config.deviceName}
        onUnpaired={() => {
          setRevoked(false);
          setConfig(null);
          setUser(null);
          setView('pairing');
        }}
      />
    );
  }

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
      <>
        <LockScreen
          deviceName={config.deviceName}
          branchName={config.branch.name}
          onUnpair={() => setUnpairPromptOpen(true)}
          onSignedIn={(u) => {
            setUser(u);
            setView('signed-in');
          }}
        />
        {unpairPromptOpen && (
          <OwnerPasswordDialog
            title="UNPAIR TERMINAL"
            description="This terminal will forget its paired branch. After this, first-run setup runs again on next launch. Confirm with the Owner password."
            confirmLabel="Unpair"
            danger
            onClose={() => setUnpairPromptOpen(false)}
            onConfirm={async () => {
              setUnpairPromptOpen(false);
              await unpair();
            }}
          />
        )}
      </>
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

  if (view === 'diagnostics') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <SyncBanner />
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <DiagnosticsPanel onClose={() => setView('signed-in')} />
        </div>
      </div>
    );
  }

  if (view === 'signed-in' && user && config) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <SyncBanner />
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <PosEmbed
            user={user}
            appVersion={appVersion}
            onSignOutRequested={() => void signOut()}
            onOpenChangePin={() => setChangePinOpen(true)}
            onOpenPrinterSettings={() => setView('printer-settings')}
            onOpenSyncPanel={() => setView('sync-panel')}
            onOpenDiagnostics={() => setView('diagnostics')}
            onRequestUnpair={() => setUnpairPromptOpen(true)}
          />
        </div>
        <UpdateToast />
        {changePinOpen && (
          <ChangePinDialog
            staffId={user.id}
            cashierName={user.name}
            onClose={() => setChangePinOpen(false)}
            onDone={() => setChangePinOpen(false)}
          />
        )}
        {unpairPromptOpen && (
          <OwnerPasswordDialog
            title="UNPAIR TERMINAL"
            description="This terminal will forget its paired branch. After this, first-run setup runs again on next launch. Confirm with the Owner password."
            confirmLabel="Unpair"
            danger
            onClose={() => setUnpairPromptOpen(false)}
            onConfirm={async () => {
              setUnpairPromptOpen(false);
              await unpair();
            }}
          />
        )}
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
