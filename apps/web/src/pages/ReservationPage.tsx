import { useState, useCallback } from 'react';
import { getActiveBranchId } from '../lib/cms';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ReservationSlot {
  time: string;
  availableBookings: number;
  availablePersons: number;
  isFull: boolean;
}

interface ReservationSettings {
  reservationTermsOfService: string | null;
}

interface Customer {
  id: string;
  name: string;
  phone: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const BASE = ((import.meta as any).env?.VITE_API_BASE_URL as string | undefined) ?? '/api/v1';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

async function pubGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error((err as { message?: string }).message ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

async function pubPost<T>(path: string, body: unknown, branchId: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Branch-Id': branchId,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error((err as { message?: string }).message ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function friendlyDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function friendlyTime(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

type Step = 'date' | 'slots' | 'otp' | 'confirm' | 'success';

export default function ReservationPage() {
  const branchId = getActiveBranchId();

  /* Step state */
  const [step, setStep] = useState<Step>('date');

  /* Step 1 - date + party */
  const today = formatDate(new Date());
  const maxDate = formatDate(new Date(Date.now() + 30 * 86_400_000));
  const [date, setDate] = useState(today);
  const [partySize, setPartySize] = useState(2);

  /* Step 2 - slots */
  const [slots, setSlots] = useState<ReservationSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<ReservationSlot | null>(null);

  /* Step 3 - OTP */
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [namePrompt, setNamePrompt] = useState(false);
  const [customerName, setCustomerName] = useState('');

  /* Step 4 - confirm */
  const [notes, setNotes] = useState('');
  const [termsText, setTermsText] = useState<string | null>(null);
  const [agreedTerms, setAgreedTerms] = useState(false);

  /* General */
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bookingResult, setBookingResult] = useState<{ id: string } | null>(null);

  /* ---- Step 1 actions ---- */
  const checkAvailability = useCallback(async () => {
    setError(null);
    setSlotsLoading(true);
    try {
      const [slotsData, settings] = await Promise.all([
        pubGet<ReservationSlot[]>(`/reservations/public/slots?branchId=${branchId}&date=${date}`),
        pubGet<ReservationSettings>(`/reservations/public/settings?branchId=${branchId}`),
      ]);
      setSlots(slotsData);
      setTermsText(settings.reservationTermsOfService ?? null);
      setSelectedSlot(null);
      setStep('slots');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSlotsLoading(false);
    }
  }, [branchId, date]);

  /* ---- Step 2 actions ---- */
  const pickSlot = useCallback((slot: ReservationSlot) => {
    if (slot.isFull || slot.availablePersons < partySize) return;
    setSelectedSlot(slot);
    setStep('otp');
  }, [partySize]);

  /* ---- Step 3 actions ---- */
  const sendOtp = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      await pubPost<{ sent: boolean; otp?: string }>('/customers/auth/request-otp', { phone }, branchId);
      setOtpSent(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [phone, branchId]);

  const verifyOtp = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await pubPost<{ customer: Customer }>('/customers/auth/verify-otp', { phone, otp }, branchId);
      setCustomer(res.customer);
      if (!res.customer.name || res.customer.name === 'Customer') {
        setNamePrompt(true);
        setCustomerName('');
      } else {
        setCustomerName(res.customer.name);
        setStep('confirm');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [phone, otp, branchId]);

  const confirmName = useCallback(() => {
    if (!customerName.trim()) return;
    setStep('confirm');
  }, [customerName]);

  /* ---- Step 4 actions ---- */
  const bookNow = useCallback(async () => {
    if (termsText && !agreedTerms) return;
    setError(null);
    setLoading(true);
    try {
      const body = {
        customerId: customer!.id,
        customerName: customerName || customer!.name,
        customerPhone: phone,
        date,
        timeSlot: selectedSlot!.time,
        partySize,
        notes: notes || undefined,
        agreedTerms: termsText ? agreedTerms : true,
      };
      const res = await pubPost<{ id: string }>('/reservations/public/book', body, branchId);
      setBookingResult(res);
      setStep('success');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [branchId, customer, customerName, phone, date, selectedSlot, partySize, notes, termsText, agreedTerms]);

  /* ---- Navigation ---- */
  const goBack = useCallback((target: Step) => {
    setError(null);
    setStep(target);
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Render helpers                                                   */
  /* ---------------------------------------------------------------- */

  const sectionCls = 'max-w-xl mx-auto px-6 py-10';

  const btnPrimary =
    'w-full bg-accent hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-3 px-6 transition-opacity';

  const btnOutline =
    'text-sm text-accent hover:opacity-80 font-semibold transition-opacity';

  const inputCls =
    'w-full border border-border bg-card text-text placeholder-muted px-4 py-3 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition';

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <div>
      {/* Hero banner */}
      <section className="py-24 px-6 bg-card border-b border-border">
        <div className="max-w-7xl mx-auto text-center">
          <p className="font-serif italic text-accent mb-2">Experience Awaits</p>
          <h1 className="font-display text-6xl md:text-7xl tracking-wider">RESERVE A TABLE</h1>
          <p className="text-muted mt-3">Book your experience in just a few steps</p>
        </div>
      </section>

      {/* Progress indicator */}
      <div className="max-w-xl mx-auto px-6 pt-8">
        <div className="flex items-center justify-between text-xs font-semibold text-muted mb-2">
          {(['Date & Party', 'Time Slot', 'Verify Phone', 'Confirm'] as const).map((label, i) => {
            const stepIdx = ['date', 'slots', 'otp', 'confirm'].indexOf(step);
            const active = i <= stepIdx;
            return (
              <div key={label} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className={`w-8 h-8 flex items-center justify-center text-sm font-bold transition-colors ${
                    active ? 'bg-accent text-white' : 'bg-hover text-muted'
                  }`}
                >
                  {i + 1}
                </div>
                <span className={active ? 'text-accent' : ''}>{label}</span>
              </div>
            );
          })}
        </div>
        <div className="w-full bg-hover h-1 overflow-hidden mb-4">
          <div
            className="h-full bg-accent transition-all duration-300"
            style={{ width: `${((['date', 'slots', 'otp', 'confirm', 'success'].indexOf(step) + 1) / 5) * 100}%` }}
          />
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="max-w-xl mx-auto px-6">
          <div className="bg-red-900/30 border border-red-800 text-red-400 px-4 py-3 text-sm">
            {error}
          </div>
        </div>
      )}

      {/* ====== STEP 1: Date + Party Size ====== */}
      {step === 'date' && (
        <div className={sectionCls}>
          <h2 className="font-display text-3xl tracking-wider mb-6">CHOOSE DATE & PARTY SIZE</h2>

          <label className="block text-sm font-semibold text-muted mb-1 uppercase tracking-wider">Date</label>
          <input
            type="date"
            value={date}
            min={today}
            max={maxDate}
            onChange={(e) => setDate(e.target.value)}
            className={`${inputCls} mb-5`}
          />

          <label className="block text-sm font-semibold text-muted mb-1 uppercase tracking-wider">Party Size</label>
          <div className="flex items-center gap-4 mb-8">
            <button
              onClick={() => setPartySize((p) => Math.max(1, p - 1))}
              className="w-10 h-10 flex items-center justify-center border border-border text-text hover:bg-hover text-xl font-bold transition-colors"
            >
              -
            </button>
            <span className="font-display text-3xl w-10 text-center">{partySize}</span>
            <button
              onClick={() => setPartySize((p) => Math.min(20, p + 1))}
              className="w-10 h-10 flex items-center justify-center border border-border text-text hover:bg-hover text-xl font-bold transition-colors"
            >
              +
            </button>
          </div>

          <button onClick={checkAvailability} disabled={slotsLoading} className={btnPrimary}>
            {slotsLoading ? 'Checking...' : 'Check Availability'}
          </button>
        </div>
      )}

      {/* ====== STEP 2: Time Slots ====== */}
      {step === 'slots' && (
        <div className={sectionCls}>
          <button onClick={() => goBack('date')} className={`${btnOutline} mb-4`}>
            &larr; Back
          </button>
          <h2 className="font-display text-3xl tracking-wider mb-2">PICK A TIME</h2>
          <p className="text-muted text-sm mb-6">
            {friendlyDate(date)} &middot; {partySize} {partySize === 1 ? 'guest' : 'guests'}
          </p>

          {slots.length === 0 ? (
            <p className="text-muted py-8 text-center">No slots available for this date.</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {slots.map((s) => {
                const disabled = s.isFull || s.availablePersons < partySize;
                const fewLeft = !disabled && s.availableBookings <= 2;
                return (
                  <button
                    key={s.time}
                    disabled={disabled}
                    onClick={() => pickSlot(s)}
                    className={`py-3 px-2 text-sm font-semibold text-center transition-colors border ${
                      disabled
                        ? 'bg-hover text-muted/50 border-border cursor-not-allowed'
                        : fewLeft
                          ? 'bg-yellow-900/20 text-yellow-400 border-yellow-800 hover:bg-yellow-900/30'
                          : 'bg-green-900/20 text-green-400 border-green-800 hover:bg-green-900/30'
                    }`}
                  >
                    {friendlyTime(s.time)}
                    {!disabled && (
                      <span className="block text-[10px] mt-0.5 opacity-70">
                        {fewLeft ? 'Few left' : `${s.availableBookings} open`}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ====== STEP 3: OTP Verification ====== */}
      {step === 'otp' && (
        <div className={sectionCls}>
          <button onClick={() => goBack('slots')} className={`${btnOutline} mb-4`}>
            &larr; Back
          </button>
          <h2 className="font-display text-3xl tracking-wider mb-6">VERIFY YOUR PHONE</h2>

          {!customer ? (
            <>
              {/* Phone input */}
              <label className="block text-sm font-semibold text-muted mb-1 uppercase tracking-wider">Phone Number</label>
              <input
                type="tel"
                placeholder="01XXXXXXXXX"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/[^0-9]/g, '').slice(0, 11))}
                className={`${inputCls} mb-4`}
              />

              {!otpSent ? (
                <button
                  onClick={sendOtp}
                  disabled={loading || phone.length < 11}
                  className={btnPrimary}
                >
                  {loading ? 'Sending...' : 'Send OTP'}
                </button>
              ) : (
                <>
                  <p className="text-green-400 text-sm mb-4">OTP sent to {phone}</p>
                  <label className="block text-sm font-semibold text-muted mb-1 uppercase tracking-wider">Enter OTP</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="6-digit code"
                    maxLength={6}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                    className={`${inputCls} mb-4 tracking-[0.3em] text-center text-lg`}
                  />
                  <button
                    onClick={verifyOtp}
                    disabled={loading || otp.length < 6}
                    className={btnPrimary}
                  >
                    {loading ? 'Verifying...' : 'Verify'}
                  </button>
                  <button
                    onClick={() => {
                      setOtpSent(false);
                      setOtp('');
                    }}
                    className={`${btnOutline} mt-3 block mx-auto`}
                  >
                    Resend OTP
                  </button>
                </>
              )}
            </>
          ) : namePrompt ? (
            <>
              <p className="text-muted text-sm mb-4">Please enter your name to continue.</p>
              <input
                type="text"
                placeholder="Your name"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className={`${inputCls} mb-4`}
              />
              <button onClick={confirmName} disabled={!customerName.trim()} className={btnPrimary}>
                Continue
              </button>
            </>
          ) : null}
        </div>
      )}

      {/* ====== STEP 4: Confirm & Book ====== */}
      {step === 'confirm' && (
        <div className={sectionCls}>
          <button onClick={() => goBack('otp')} className={`${btnOutline} mb-4`}>
            &larr; Back
          </button>
          <h2 className="font-display text-3xl tracking-wider mb-6">CONFIRM RESERVATION</h2>

          {/* Summary card */}
          <div className="bg-hover border border-border p-5 mb-6 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">Name</span>
              <span className="font-semibold text-text">{customerName || customer?.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Phone</span>
              <span className="font-semibold text-text">{phone}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Date</span>
              <span className="font-semibold text-text">{friendlyDate(date)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Time</span>
              <span className="font-semibold text-text">{selectedSlot ? friendlyTime(selectedSlot.time) : ''}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Party Size</span>
              <span className="font-semibold text-text">{partySize} {partySize === 1 ? 'guest' : 'guests'}</span>
            </div>
          </div>

          {/* Notes */}
          <label className="block text-sm font-semibold text-muted mb-1 uppercase tracking-wider">Special Requests (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Allergies, seating preferences, celebrations..."
            className={`${inputCls} mb-5 resize-none`}
          />

          {/* Terms of Service */}
          {termsText && (
            <div className="mb-5">
              <div className="bg-hover border border-border p-4 text-xs text-muted max-h-32 overflow-y-auto mb-3 whitespace-pre-wrap">
                {termsText}
              </div>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreedTerms}
                  onChange={(e) => setAgreedTerms(e.target.checked)}
                  className="mt-0.5 accent-[var(--accent)]"
                />
                <span className="text-sm text-muted">I agree to the Terms of Service</span>
              </label>
            </div>
          )}

          <button
            onClick={bookNow}
            disabled={loading || (!!termsText && !agreedTerms)}
            className={btnPrimary}
          >
            {loading ? 'Booking...' : 'Book Now'}
          </button>
        </div>
      )}

      {/* ====== STEP 5: Success ====== */}
      {step === 'success' && (
        <div className={sectionCls + ' text-center'}>
          {/* Checkmark */}
          <div className="w-20 h-20 mx-auto mb-6 bg-green-900/30 border border-green-800 flex items-center justify-center">
            <svg className="w-10 h-10 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>

          <h2 className="font-display text-3xl tracking-wider mb-2">RESERVATION CONFIRMED!</h2>
          <p className="text-muted mb-8">You&apos;ll receive an SMS confirmation shortly.</p>

          <div className="bg-hover border border-border p-5 text-left space-y-2 text-sm mb-8">
            {bookingResult?.id && (
              <div className="flex justify-between">
                <span className="text-muted">Booking ID</span>
                <span className="font-mono text-text text-xs">{bookingResult.id.slice(0, 8).toUpperCase()}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted">Name</span>
              <span className="font-semibold text-text">{customerName || customer?.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Date</span>
              <span className="font-semibold text-text">{friendlyDate(date)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Time</span>
              <span className="font-semibold text-text">{selectedSlot ? friendlyTime(selectedSlot.time) : ''}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Party Size</span>
              <span className="font-semibold text-text">{partySize} {partySize === 1 ? 'guest' : 'guests'}</span>
            </div>
          </div>

          <a href="/" className={btnPrimary + ' inline-block text-center no-underline'}>
            Back to Home
          </a>
        </div>
      )}
    </div>
  );
}
