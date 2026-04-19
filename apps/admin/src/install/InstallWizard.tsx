import { useState } from 'react';
import { installApi, InstallApiError, type SystemCheck } from './install-api';
import { STEPS, useInstallFlow } from './useInstallFlow';

/**
 * Top-level wizard shell. Rendered by apps/admin/src/App.tsx when
 * `GET /install/status` returns needsInstall: true. Takes over the
 * full viewport — no login, no sidebar, no layout chrome. Once the
 * last step succeeds, we set needsInstall=false by refetching the
 * status + reloading so React/SW state is fresh.
 *
 * Styling reuses existing Tailwind utilities from the admin app —
 * no new components imported so this file can survive a future
 * design-system migration without structural churn.
 */
export default function InstallWizard() {
  const flow = useInstallFlow();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof InstallApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-2xl bg-white shadow-lg">
        <header className="border-b p-6">
          <h1 className="text-2xl font-semibold">Welcome — let's set up your POS</h1>
          <p className="text-sm text-gray-500 mt-1">
            This one-time wizard creates the first branch and owner account.
          </p>
          <ol className="flex gap-2 mt-4 text-xs">
            {STEPS.map((s, i) => {
              const active = s.key === flow.step;
              const done = STEPS.findIndex((x) => x.key === flow.step) > i;
              return (
                <li
                  key={s.key}
                  className={[
                    'px-3 py-1 border',
                    active ? 'border-black bg-black text-white' : done ? 'border-green-500 text-green-700' : 'border-gray-300 text-gray-500',
                  ].join(' ')}
                >
                  {i + 1}. {s.label}
                </li>
              );
            })}
          </ol>
        </header>

        <div className="p-6 min-h-[320px]">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>
          )}

          {flow.step === 'system-check' && (
            <SystemCheckStep
              busy={busy}
              onNext={() =>
                run(async () => {
                  const r = await installApi.systemCheck();
                  if (!r.db || !r.nodeOk || r.requiredEnvs.some((e) => !e.present)) {
                    throw new InstallApiError(400, 'System check failed — see diagnostics above.');
                  }
                  flow.next();
                })
              }
            />
          )}

          {flow.step === 'license' && (
            <LicenseStep
              value={flow.license}
              onChange={flow.setLicense}
              busy={busy}
              onBack={flow.back}
              onNext={() =>
                run(async () => {
                  // If already activated (re-running wizard after a
                  // crash mid-flow), skip forward without prompting.
                  const status = await installApi.licenseStatus();
                  if (status.mode === 'active' || status.mode === 'grace') {
                    flow.next();
                    return;
                  }
                  const trimmed = {
                    purchaseCode: flow.license.purchaseCode.trim(),
                    domain: flow.license.domain.trim(),
                  };
                  const res = await installApi.activateLicense(trimmed);
                  if (res.mode !== 'active' && res.mode !== 'grace') {
                    throw new InstallApiError(400, `Activation returned mode=${res.mode}`);
                  }
                  flow.next();
                })
              }
            />
          )}

          {flow.step === 'branch' && (
            <BranchStep
              value={flow.branch}
              onChange={flow.setBranch}
              busy={busy}
              onBack={flow.back}
              onNext={() =>
                run(async () => {
                  await installApi.createBranch(flow.branch);
                  flow.next();
                })
              }
            />
          )}

          {flow.step === 'owner' && (
            <OwnerStep
              value={flow.owner}
              onChange={flow.setOwner}
              busy={busy}
              onBack={flow.back}
              onNext={() =>
                run(async () => {
                  await installApi.createOwner(flow.owner);
                  flow.next();
                })
              }
            />
          )}

          {flow.step === 'brand' && (
            <BrandStep
              value={flow.brand}
              onChange={flow.setBrand}
              busy={busy}
              onBack={flow.back}
              onNext={() => {
                flow.next();
              }}
            />
          )}

          {flow.step === 'done' && (
            <DoneStep
              busy={busy}
              onFinish={() =>
                run(async () => {
                  await installApi.finish({
                    brandName: flow.brand.brandName || undefined,
                    supportEmail: flow.brand.supportEmail || undefined,
                  });
                  // Reload IN PLACE so the LicenseGuard + any cached
                  // query state rehydrate with installedAt=now. Prior
                  // version used `window.location.href = '/'` which
                  // redirected buyers mounted at a subpath (e.g.
                  // /admin/) to the public website at root. Stay on
                  // whatever URL served the wizard — the App.tsx
                  // /install/status fetch re-runs on mount and
                  // renders the login page instead of the wizard.
                  window.location.reload();
                })
              }
              onBack={flow.back}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── steps ────────────────────────────────────────────────────────────

function SystemCheckStep({ busy, onNext }: { busy: boolean; onNext: () => void }) {
  const [result, setResult] = useState<SystemCheck | null>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    try {
      setResult(await installApi.systemCheck());
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <h2 className="text-lg font-medium mb-2">System requirements</h2>
      <p className="text-sm text-gray-500 mb-4">
        Checking your server can reach the database and has everything it needs.
      </p>
      {!result ? (
        <Button onClick={run} disabled={running}>
          {running ? 'Running…' : 'Run system check'}
        </Button>
      ) : (
        <ul className="space-y-1 text-sm">
          <Row ok={result.db} label="Database reachable" />
          <Row ok={result.nodeOk} label={`Node.js ${result.nodeVersion}`} />
          {result.requiredEnvs.map((e) => (
            <Row key={e.key} ok={e.present} label={`Env ${e.key}`} />
          ))}
        </ul>
      )}
      <div className="mt-6 flex justify-end">
        <Button onClick={onNext} disabled={busy || !result || !result.db || !result.nodeOk}>
          Next →
        </Button>
      </div>
    </div>
  );
}

function LicenseStep({
  value,
  onChange,
  busy,
  onBack,
  onNext,
}: {
  value: { purchaseCode: string; domain: string };
  onChange: (v: { purchaseCode: string; domain: string }) => void;
  busy: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div>
      <h2 className="text-lg font-medium mb-2">Activate your license</h2>
      <p className="text-sm text-gray-500 mb-4">
        Paste the purchase code from your CodeCanyon order email + the domain
        this install will run on. Activation binds the license to this domain;
        you can move it later via <strong>Settings → License → Deactivate</strong>.
      </p>
      <div className="space-y-3">
        <Input
          label="Purchase code"
          value={value.purchaseCode}
          onChange={(purchaseCode) => onChange({ ...value, purchaseCode })}
        />
        <Input
          label="Domain (this hostname)"
          value={value.domain}
          onChange={(domain) => onChange({ ...value, domain })}
        />
      </div>
      <p className="text-xs text-gray-400 mt-3 leading-relaxed">
        This step requires an internet connection to reach the license server.
        If activation keeps failing, check your firewall allows outbound
        HTTPS to <span className="font-mono">api.neawaslic.top</span>, or ask
        support for help. The wizard will not continue without an active
        license.
      </p>
      <Nav
        onBack={onBack}
        onNext={onNext}
        disabled={busy || value.purchaseCode.trim().length < 8 || value.domain.trim().length < 3}
        nextLabel={busy ? 'Activating…' : 'Activate + continue →'}
      />
    </div>
  );
}

function BranchStep({
  value,
  onChange,
  busy,
  onBack,
  onNext,
}: {
  value: { name: string; address: string; phone: string };
  onChange: (v: { name: string; address: string; phone: string }) => void;
  busy: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div>
      <h2 className="text-lg font-medium mb-4">Create your first branch</h2>
      <div className="space-y-3">
        <Input label="Branch name" value={value.name} onChange={(name) => onChange({ ...value, name })} />
        <Input label="Address" value={value.address} onChange={(address) => onChange({ ...value, address })} />
        <Input label="Phone" value={value.phone} onChange={(phone) => onChange({ ...value, phone })} />
      </div>
      <Nav onBack={onBack} onNext={onNext} disabled={busy || !value.name || !value.address || !value.phone} />
    </div>
  );
}

function OwnerStep({
  value,
  onChange,
  busy,
  onBack,
  onNext,
}: {
  value: { name: string; email: string; password: string };
  onChange: (v: { name: string; email: string; password: string }) => void;
  busy: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div>
      <h2 className="text-lg font-medium mb-4">Owner account</h2>
      <p className="text-sm text-gray-500 mb-4">
        This is the admin login you'll use to manage the POS.
      </p>
      <div className="space-y-3">
        <Input label="Full name" value={value.name} onChange={(name) => onChange({ ...value, name })} />
        <Input label="Email" type="email" value={value.email} onChange={(email) => onChange({ ...value, email })} />
        <Input
          label="Password (min 8 characters)"
          type="password"
          value={value.password}
          onChange={(password) => onChange({ ...value, password })}
        />
      </div>
      <Nav
        onBack={onBack}
        onNext={onNext}
        disabled={busy || !value.name || !value.email || value.password.length < 8}
      />
    </div>
  );
}

function BrandStep({
  value,
  onChange,
  busy,
  onBack,
  onNext,
}: {
  value: { brandName: string; supportEmail: string };
  onChange: (v: { brandName: string; supportEmail: string }) => void;
  busy: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div>
      <h2 className="text-lg font-medium mb-4">Branding (optional)</h2>
      <p className="text-sm text-gray-500 mb-4">
        These show up on receipts, the admin header, and the public website. You can change them later in Settings.
      </p>
      <div className="space-y-3">
        <Input
          label="Restaurant name"
          value={value.brandName}
          onChange={(brandName) => onChange({ ...value, brandName })}
        />
        <Input
          label="Support email"
          type="email"
          value={value.supportEmail}
          onChange={(supportEmail) => onChange({ ...value, supportEmail })}
        />
      </div>
      <Nav onBack={onBack} onNext={onNext} disabled={busy} />
    </div>
  );
}

function DoneStep({ busy, onFinish, onBack }: { busy: boolean; onFinish: () => void; onBack: () => void }) {
  return (
    <div>
      <h2 className="text-lg font-medium mb-4">Ready to finish</h2>
      <p className="text-sm text-gray-500 mb-4">
        Click Finish to complete setup. You'll be taken to the login page to sign in as the owner.
      </p>
      <p className="text-sm text-gray-500 mb-4">
        Activate your license from the login screen's footer link once you're signed in.
      </p>
      <Nav onBack={onBack} onNext={onFinish} nextLabel={busy ? 'Finishing…' : 'Finish'} disabled={busy} />
    </div>
  );
}

// ── primitives ───────────────────────────────────────────────────────

function Input({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="text-gray-700">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 block w-full border border-gray-300 px-3 py-2 focus:outline-none focus:border-black"
      />
    </label>
  );
}

function Button({
  children,
  onClick,
  disabled,
  variant = 'primary',
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'ghost';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        'px-4 py-2 text-sm border',
        variant === 'primary'
          ? 'bg-black text-white border-black disabled:bg-gray-300 disabled:border-gray-300'
          : 'bg-white text-gray-700 border-gray-300',
        'disabled:cursor-not-allowed',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function Row({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2">
      <span className={ok ? 'text-green-600' : 'text-red-600'}>{ok ? '✓' : '✗'}</span>
      <span>{label}</span>
    </li>
  );
}

function Nav({
  onBack,
  onNext,
  disabled,
  nextLabel = 'Next →',
}: {
  onBack: () => void;
  onNext: () => void;
  disabled?: boolean;
  nextLabel?: string;
}) {
  return (
    <div className="mt-6 flex justify-between">
      <Button variant="ghost" onClick={onBack}>
        ← Back
      </Button>
      <Button onClick={onNext} disabled={disabled}>
        {nextLabel}
      </Button>
    </div>
  );
}
