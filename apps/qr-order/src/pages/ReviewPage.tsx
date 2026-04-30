import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Star } from 'lucide-react';

import { useSessionStore } from '../store/session.store';
import { apiUrl } from '../lib/api';

/**
 * /review/:orderId — post-meal review form.
 *
 * Login is required. If a non-logged-in customer lands here, they're
 * bounced to /login with a return URL. The submitted review goes to
 * `POST /customers/reviews` (already public on the backend) with
 * x-branch-id header, scored on four 1–5 dimensions plus an optional
 * notes field.
 */

const SCORE_LABELS = ['Bad', 'Okay', 'Good', 'Great', 'Amazing'];

interface ScoreRowProps {
  label: string;
  value: number;
  onChange: (n: number) => void;
}

function ScoreRow({ label, value, onChange }: ScoreRowProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <p className="font-body text-sm text-white">{label}</p>
        <p className="text-[10px] font-body text-[#888] uppercase tracking-widest">
          {value > 0 ? SCORE_LABELS[value - 1] : 'Tap a star'}
        </p>
      </div>
      <div className="flex gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            aria-label={`${label} score ${n}`}
            className={`w-10 h-10 flex items-center justify-center border transition-colors ${
              n <= value
                ? 'bg-[#FFA726]/15 border-[#FFA726] text-[#FFA726]'
                : 'bg-[#0D0D0D] border-[#2A2A2A] text-[#444] hover:border-[#FFA726]/50'
            }`}
          >
            <Star size={18} className={n <= value ? 'fill-[#FFA726]' : ''} />
          </button>
        ))}
      </div>
    </div>
  );
}

export default function ReviewPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const branchId = useSessionStore((s) => s.branchId);
  const customer = useSessionStore((s) => s.customer);

  const [foodScore, setFoodScore] = useState(0);
  const [serviceScore, setServiceScore] = useState(0);
  const [atmosphereScore, setAtmosphereScore] = useState(0);
  const [priceScore, setPriceScore] = useState(0);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Login gate. Defensive: the OrderStatusPage already checks before
  // navigating here, but if a customer hits the URL directly we still
  // need to prompt them to log in.
  useEffect(() => {
    if (!customer) {
      void navigate(`/login?next=/review/${orderId}`, { replace: true });
    }
  }, [customer, navigate, orderId]);

  const allScored = foodScore > 0 && serviceScore > 0 && atmosphereScore > 0 && priceScore > 0;

  const submit = async () => {
    if (!allScored || !orderId || !branchId || !customer) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(apiUrl('/customers/reviews'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-branch-id': branchId },
        body: JSON.stringify({
          orderId,
          customerId: customer.id,
          foodScore,
          serviceScore,
          atmosphereScore,
          priceScore,
          notes: notes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Failed to submit review' })) as { message?: string };
        throw new Error(err.message ?? 'Failed to submit review');
      }
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="min-h-screen bg-[#0D0D0D] flex flex-col items-center justify-center px-5">
        <div className="w-16 h-16 bg-[#C8FF00]/15 flex items-center justify-center mb-5">
          <Star size={32} className="text-[#C8FF00] fill-[#C8FF00]" />
        </div>
        <h1 className="font-display text-3xl text-white tracking-wider mb-2">THANK YOU</h1>
        <p className="text-sm text-[#888] font-body text-center mb-8 max-w-xs">
          Your review helps us serve you better next time.
        </p>
        <button
          onClick={() => void navigate('/menu')}
          className="bg-[#C8FF00] text-[#0D0D0D] px-8 py-3.5 font-body font-medium text-sm"
        >
          Back to Menu
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0D0D0D] pb-28">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-[#0D0D0D] px-5 py-4 flex items-center justify-between border-b border-[#1F1F1F]">
        <button
          onClick={() => void navigate(-1)}
          className="w-9 h-9 bg-[#1A1A1A] border border-[#2A2A2A] flex items-center justify-center text-white"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="text-center">
          <h1 className="font-display text-xl text-white tracking-wider">REVIEW ORDER</h1>
          {customer?.name && (
            <p className="text-[10px] font-body text-[#888] tracking-widest uppercase">
              {customer.name}
            </p>
          )}
        </div>
        <div className="w-9" />
      </div>

      <div className="px-5 py-5 space-y-6">
        <ScoreRow label="Food quality" value={foodScore} onChange={setFoodScore} />
        <ScoreRow label="Service" value={serviceScore} onChange={setServiceScore} />
        <ScoreRow label="Atmosphere" value={atmosphereScore} onChange={setAtmosphereScore} />
        <ScoreRow label="Price / value" value={priceScore} onChange={setPriceScore} />

        <div className="space-y-2">
          <p className="font-body text-sm text-white">Tell us more (optional)</p>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything we should know? Compliments or things to improve…"
            rows={4}
            className="w-full bg-[#1A1A1A] border border-[#2A2A2A] px-3 py-2.5 text-sm font-body text-white outline-none focus:border-[#C8FF00] resize-none"
          />
        </div>

        {error && <p className="text-xs text-[#D62B2B] font-body">{error}</p>}
      </div>

      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] bg-[#0D0D0D] border-t border-[#2A2A2A] px-5 py-4 z-20">
        <button
          onClick={() => void submit()}
          disabled={!allScored || busy}
          className="w-full bg-[#C8FF00] text-[#0D0D0D] py-3.5 font-body font-medium text-sm disabled:opacity-40"
        >
          {busy ? 'Submitting…' : allScored ? 'Submit Review' : 'Tap a star on each row'}
        </button>
      </div>
    </div>
  );
}
