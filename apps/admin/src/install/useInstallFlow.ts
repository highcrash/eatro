import { useState } from 'react';

export type StepKey = 'system-check' | 'license' | 'branch' | 'owner' | 'brand' | 'done';

export const STEPS: { key: StepKey; label: string }[] = [
  { key: 'system-check', label: 'System Check' },
  // License activation is deliberately BEFORE branch/owner creation.
  // If a buyer can't activate (wrong code, code already used, offline),
  // the wizard refuses to create any real data — nothing to clean up on
  // a failed attempt. Also prevents the "install, browse, never pay"
  // attack where a pirate completes the wizard and gets read access.
  { key: 'license', label: 'License' },
  { key: 'branch', label: 'First Branch' },
  { key: 'owner', label: 'Owner Account' },
  { key: 'brand', label: 'Branding' },
  { key: 'done', label: 'Finish' },
];

/**
 * Small state machine for the wizard. Each step is a dumb controlled
 * component that reads/writes `data` and calls `next()` when its own
 * submit succeeds. The wizard shell decides when to render which step.
 *
 * Why a hook and not a reducer: the wizard is linear (no jumps
 * backward beyond "let me re-enter this field") and each step's data
 * is independent of the others. A flat `data` object is simpler than
 * a discriminated union of step-specific types.
 */
export function useInstallFlow() {
  const [step, setStep] = useState<StepKey>('system-check');
  const [license, setLicense] = useState<{ purchaseCode: string; domain: string }>({
    purchaseCode: '',
    // Prefill from the URL the wizard is running under — 90% of buyers
    // activate against the same hostname they visited to install. They
    // can edit if using a wildcard license (*.example.com).
    domain: typeof window !== 'undefined' ? window.location.hostname : '',
  });
  const [branch, setBranch] = useState<{ name: string; address: string; phone: string }>({
    name: '',
    address: '',
    phone: '',
  });
  const [owner, setOwner] = useState<{ name: string; email: string; password: string }>({
    name: '',
    email: '',
    password: '',
  });
  const [brand, setBrand] = useState<{ brandName: string; supportEmail: string }>({
    brandName: '',
    supportEmail: '',
  });

  const next = () => {
    const i = STEPS.findIndex((s) => s.key === step);
    if (i < STEPS.length - 1) setStep(STEPS[i + 1]!.key);
  };

  const back = () => {
    const i = STEPS.findIndex((s) => s.key === step);
    if (i > 0) setStep(STEPS[i - 1]!.key);
  };

  return { step, setStep, next, back, license, setLicense, branch, setBranch, owner, setOwner, brand, setBrand };
}
