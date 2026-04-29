import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Phone, ShieldCheck, User, Loader2 } from 'lucide-react';

import { apiUrl } from '../lib/api';
import { useSessionStore } from '../store/session.store';

type Step = 'phone' | 'otp' | 'profile';

interface OtpRequestResponse {
  sent: boolean;
  phone: string;
  /** Dev-mode echo when SMS isn't wired. */
  otp?: string;
}

interface VerifyResponse {
  customer: { id: string; name: string; phone: string; email: string | null } | null;
  isWalkIn?: boolean;
  isNew: boolean;
  phone?: string;
}

interface SignupResponse {
  id: string;
  name: string;
  phone: string;
  email: string | null;
}

/** Customer login flow for QR-order. Three steps in one screen:
 *
 *   1. Phone — Bangladesh-only (11-digit local). Server-side normaliser
 *      accepts +8801…/8801…/01… all the same. We surface a friendly
 *      11-digit example and disable Continue until the input matches.
 *   2. OTP — 6-digit code. Dev mode returns the OTP in the request
 *      response; we auto-fill it so testers don't need real SMS. Real
 *      deploys hide that field.
 *   3. Profile — only shown when the customer is new OR on file with
 *      the placeholder "Walk-in" name. Captures Name (required) +
 *      Email (optional) and finalises the session.
 *
 *  After login, the page navigates to ?next=… (if present, e.g. /cart
 *  for the add-to-cart gate) or back to /menu otherwise.
 */
export default function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') || '/menu';

  const branchId = useSessionStore((s) => s.branchId);
  const setCustomer = useSessionStore((s) => s.setCustomer);
  const existing = useSessionStore((s) => s.customer);

  // Bounce already-logged-in users straight to next — re-running the
  // flow on a cached session is busywork.
  useEffect(() => {
    if (existing) navigate(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [normalizedPhone, setNormalizedPhone] = useState<string>('');
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pendingCustomer, setPendingCustomer] = useState<VerifyResponse['customer']>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>('');

  // Loose front-end gate — server is the authoritative validator. We
  // accept anything the normaliser will accept: 01XXXXXXXXX, +8801XX…,
  // 8801XX…, 1XXXXXXXXX. The "Continue" button enables once the input
  // looks plausible.
  const looksLikeBdMobile = (raw: string): boolean => {
    const cleaned = raw.replace(/[\s+\-()]/g, '');
    if (/^01[3-9]\d{8}$/.test(cleaned)) return true;
    if (/^8801[3-9]\d{8}$/.test(cleaned)) return true;
    if (/^1[3-9]\d{8}$/.test(cleaned)) return true;
    return false;
  };

  const requestOtp = async () => {
    setBusy(true); setError('');
    try {
      const res = await fetch(apiUrl('/customers/auth/request-otp'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-branch-id': branchId || '' },
        body: JSON.stringify({ phone }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { message?: string }).message || 'Could not send OTP');
      }
      const data = (await res.json()) as OtpRequestResponse;
      setNormalizedPhone(data.phone);
      setDevOtp(data.otp ?? null);
      // Pre-fill the OTP in dev so the tester can just hit Verify.
      if (data.otp) setOtp(data.otp);
      setStep('otp');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async () => {
    setBusy(true); setError('');
    try {
      const res = await fetch(apiUrl('/customers/auth/verify-otp'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-branch-id': branchId || '' },
        body: JSON.stringify({ phone: normalizedPhone || phone, otp }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { message?: string }).message || 'Invalid OTP');
      }
      const data = (await res.json()) as VerifyResponse;

      // Brand-new customer → ask for name + email.
      if (data.isNew) {
        setPendingCustomer(null);
        setName('');
        setEmail('');
        setStep('profile');
        return;
      }

      // Existing customer with a Walk-in placeholder → ask for the real
      // name (empty input — don't show "Walk-in" as a default).
      if (data.customer && data.isWalkIn) {
        setPendingCustomer(data.customer);
        setName('');
        setEmail(data.customer.email ?? '');
        setStep('profile');
        return;
      }

      // Existing customer with a proper name → done, log them in.
      if (data.customer) {
        setCustomer({
          id: data.customer.id,
          name: data.customer.name,
          phone: data.customer.phone,
          email: data.customer.email,
        });
        navigate(next, { replace: true });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitProfile = async () => {
    if (!name.trim()) { setError('Name is required'); return; }
    setBusy(true); setError('');
    try {
      // Existing Walk-in customer — patch the name/email in place.
      if (pendingCustomer) {
        const res = await fetch(apiUrl('/customers/auth/profile'), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customerId: pendingCustomer.id, name: name.trim(), email: email.trim() || undefined }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { message?: string }).message || 'Could not save profile');
        }
        const updated = (await res.json()) as SignupResponse;
        setCustomer({ id: updated.id, name: updated.name, phone: updated.phone, email: updated.email });
        navigate(next, { replace: true });
        return;
      }
      // Brand-new signup.
      const res = await fetch(apiUrl('/customers/auth/signup'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-branch-id': branchId || '' },
        body: JSON.stringify({ phone: normalizedPhone || phone, name: name.trim(), email: email.trim() || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { message?: string }).message || 'Could not create account');
      }
      const created = (await res.json()) as SignupResponse;
      setCustomer({ id: created.id, name: created.name, phone: created.phone, email: created.email });
      navigate(next, { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Auto-focus per step so the keyboard appears on mobile without an
  // extra tap.
  const phoneRef = useRef<HTMLInputElement>(null);
  const otpRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (step === 'phone') phoneRef.current?.focus();
    if (step === 'otp') otpRef.current?.focus();
    if (step === 'profile') nameRef.current?.focus();
  }, [step]);

  return (
    <div className="min-h-screen bg-[#0D0D0D] flex flex-col">
      <div className="px-5 py-4 flex items-center gap-3">
        <button
          onClick={() => {
            if (step === 'otp') { setStep('phone'); setOtp(''); setError(''); return; }
            if (step === 'profile') { setStep('otp'); setError(''); return; }
            void navigate(-1);
          }}
          className="w-9 h-9 bg-[#1A1A1A] border border-[#2A2A2A] flex items-center justify-center text-white"
        >
          <ArrowLeft size={16} />
        </button>
        <span className="font-display text-xl text-white tracking-wider">Sign in</span>
      </div>

      <div className="flex-1 flex flex-col justify-center px-6 pb-12 max-w-md mx-auto w-full">
        {step === 'phone' && (
          <div className="space-y-6">
            <div className="space-y-2">
              <div className="w-12 h-12 bg-[#C8FF00] flex items-center justify-center">
                <Phone size={20} className="text-[#0D0D0D]" />
              </div>
              <h1 className="font-display text-3xl text-white tracking-wider">Enter your number</h1>
              <p className="text-[#999] font-body text-sm">
                We'll send a one-time code to verify it. Bangladesh mobiles only — e.g. <span className="text-[#DDD]">01XXXXXXXXX</span>.
              </p>
            </div>
            <div>
              <label className="text-[#666] text-[10px] tracking-widest uppercase font-body">Mobile number</label>
              <input
                ref={phoneRef}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="01XXXXXXXXX"
                className="mt-1 w-full bg-[#1A1A1A] border border-[#2A2A2A] px-4 py-3 text-base font-body text-white outline-none focus:border-[#C8FF00]/40"
              />
            </div>
            {error && <p className="text-red-400 text-sm font-body">{error}</p>}
            <button
              onClick={() => void requestOtp()}
              disabled={!looksLikeBdMobile(phone) || busy}
              className="w-full bg-[#C8FF00] text-[#0D0D0D] py-4 font-body font-medium text-sm flex items-center justify-center gap-2 disabled:opacity-40"
            >
              {busy && <Loader2 size={14} className="animate-spin" />}
              {busy ? 'Sending…' : 'Send code'}
            </button>
          </div>
        )}

        {step === 'otp' && (
          <div className="space-y-6">
            <div className="space-y-2">
              <div className="w-12 h-12 bg-[#C8FF00] flex items-center justify-center">
                <ShieldCheck size={20} className="text-[#0D0D0D]" />
              </div>
              <h1 className="font-display text-3xl text-white tracking-wider">Verify code</h1>
              <p className="text-[#999] font-body text-sm">
                Enter the 6-digit code we sent to <span className="text-white">{normalizedPhone}</span>.
              </p>
              {devOtp && (
                <p className="text-[#FFA726] font-body text-xs">
                  Dev mode: SMS not wired. Code is <span className="font-mono">{devOtp}</span>.
                </p>
              )}
            </div>
            <div>
              <label className="text-[#666] text-[10px] tracking-widest uppercase font-body">Verification code</label>
              <input
                ref={otpRef}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                placeholder="123456"
                className="mt-1 w-full bg-[#1A1A1A] border border-[#2A2A2A] px-4 py-3 text-2xl tracking-widest font-mono text-white outline-none focus:border-[#C8FF00]/40 text-center"
              />
            </div>
            {error && <p className="text-red-400 text-sm font-body">{error}</p>}
            <button
              onClick={() => void verifyOtp()}
              disabled={otp.length !== 6 || busy}
              className="w-full bg-[#C8FF00] text-[#0D0D0D] py-4 font-body font-medium text-sm flex items-center justify-center gap-2 disabled:opacity-40"
            >
              {busy && <Loader2 size={14} className="animate-spin" />}
              {busy ? 'Verifying…' : 'Verify'}
            </button>
            <button
              onClick={() => { setStep('phone'); setOtp(''); setError(''); }}
              className="w-full text-[#999] hover:text-white font-body text-xs tracking-widest uppercase"
            >
              Use a different number
            </button>
          </div>
        )}

        {step === 'profile' && (
          <div className="space-y-6">
            <div className="space-y-2">
              <div className="w-12 h-12 bg-[#C8FF00] flex items-center justify-center">
                <User size={20} className="text-[#0D0D0D]" />
              </div>
              <h1 className="font-display text-3xl text-white tracking-wider">
                {pendingCustomer ? 'Welcome back' : 'One last thing'}
              </h1>
              <p className="text-[#999] font-body text-sm">
                {pendingCustomer
                  ? 'We have your number on file. What should we call you?'
                  : 'Tell us your name so the kitchen can address your order.'}
              </p>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[#666] text-[10px] tracking-widest uppercase font-body">Name <span className="text-red-400">*</span></label>
                <input
                  ref={nameRef}
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  className="mt-1 w-full bg-[#1A1A1A] border border-[#2A2A2A] px-4 py-3 text-base font-body text-white outline-none focus:border-[#C8FF00]/40"
                />
              </div>
              <div>
                <label className="text-[#666] text-[10px] tracking-widest uppercase font-body">Email (optional)</label>
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="mt-1 w-full bg-[#1A1A1A] border border-[#2A2A2A] px-4 py-3 text-base font-body text-white outline-none focus:border-[#C8FF00]/40"
                />
              </div>
            </div>
            {error && <p className="text-red-400 text-sm font-body">{error}</p>}
            <button
              onClick={() => void submitProfile()}
              disabled={!name.trim() || busy}
              className="w-full bg-[#C8FF00] text-[#0D0D0D] py-4 font-body font-medium text-sm flex items-center justify-center gap-2 disabled:opacity-40"
            >
              {busy && <Loader2 size={14} className="animate-spin" />}
              {busy ? 'Saving…' : 'Continue'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
