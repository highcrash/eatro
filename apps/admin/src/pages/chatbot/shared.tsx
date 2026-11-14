import { X } from 'lucide-react';

export const INPUT = 'bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body outline-none focus:border-[#D62B2B] placeholder:text-[#555]';
export const LABEL = 'text-[#666] text-xs font-body font-medium tracking-widest uppercase block mb-1';
export const PRIMARY = 'bg-[#D62B2B] hover:bg-[#F03535] text-white font-body text-sm px-4 py-2 transition-colors disabled:opacity-40';
export const GHOST = 'border border-[#2A2A2A] text-[#999] hover:border-[#555] hover:text-white font-body text-sm px-4 py-2 transition-colors disabled:opacity-40';
export const CARD = 'bg-[#161616] border border-[#2A2A2A]';
export const HINT = 'text-[#666] font-body text-xs';

export const friendly = (e: unknown) => ((e as Error)?.message ?? 'Something went wrong').replace(/^[A-Z_]+:\s*/, '').replace(/^./, (c) => c.toUpperCase());
export const fmtTime = (iso: string) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};
export const taka = (n: number) => `৳${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

export type ChatChannel = 'WEB' | 'MESSENGER' | 'INSTAGRAM' | 'WHATSAPP';
export type ChatMode = 'OFF' | 'SUGGEST' | 'AUTO';
export const CHANNEL_LABEL: Record<ChatChannel, string> = { WEB: 'Website', MESSENGER: 'Messenger', INSTAGRAM: 'Instagram', WHATSAPP: 'WhatsApp' };
export const CHANNEL_COLOR: Record<ChatChannel, string> = { WEB: '#999', MESSENGER: '#4A90E2', INSTAGRAM: '#E1306C', WHATSAPP: '#25D366' };

export interface MenuCard { name: string; price: number; wasPrice: number | null; imageUrl: string | null; url: string }

export interface ChatMessage {
  id: string;
  sender: 'CUSTOMER' | 'BOT' | 'STAFF';
  source: string | null;
  status: 'SENT' | 'DRAFT' | 'DISCARDED' | 'SHADOW';
  text: string;
  cards: MenuCard[] | null;
  hasImage: boolean;
  createdAt: string;
  staffName?: string | null;
  aiConnectionName?: string | null;
}

export interface PricedOption { label: string; perHead: number; total: number; lines: { name: string; qty: number; lineTotal: number }[] }

export interface ChatLead {
  id: string;
  conversationId: string;
  name: string | null;
  phone: string | null;
  guests: number;
  date: string | null;
  time: string | null;
  occasion: string | null;
  quote: PricedOption[] | null;
  status: 'NEW' | 'CONTACTED' | 'BOOKED' | 'LOST';
  notes: string | null;
  reservationId: string | null;
  createdAt: string;
  conversation?: { channel: ChatChannel; customerName: string | null; customerPhone: string | null };
}

export interface ConversationSummary {
  id: string;
  channel: ChatChannel;
  customerName: string | null;
  customerPhone: string | null;
  status: 'BOT' | 'HUMAN' | 'CLOSED';
  needsStaff: boolean;
  needsStaffReason: string | null;
  staffUnread: number;
  lastMessageAt: string;
  lastMessage: { text: string; sender: string; status: string; createdAt: string } | null;
  drafts: number;
}

export interface ConversationDetail extends Omit<ConversationSummary, 'lastMessage' | 'drafts'> {
  humanUntil: string | null;
  messages: ChatMessage[];
  leads: ChatLead[];
}

export interface ChatbotSettings {
  webMode: ChatMode;
  messengerMode: ChatMode;
  instagramMode: ChatMode;
  whatsappMode: ChatMode;
  assistantName: string;
  greeting: string;
  fallbackText: string;
  partyRules: string | null;
  visionEnabled: boolean;
  imageDailyLimit: number;
  humanPauseHours: number;
  retentionDays: number;
  usdRate: number;
  commentMode: ChatMode;
  autoHideSpam: boolean;
  complaintMode: 'DRAFT' | 'HOLDING' | 'STAFF_ONLY';
  complaintReminderMins: number;
  managerPhone: string | null;
  complaintSmsEnabled: boolean;
  commentHourlyCap: number;
  whatsappMonthlyCap: number;
  verifyPhoneEnabled: boolean;
  welcomeCouponEnabled: boolean;
  welcomeCouponPercent: number;
  welcomeCouponDays: number;
  pageConnected?: boolean;
  instagramConnected?: boolean;
  whatsappConnected?: boolean;
  whatsappSentThisMonth?: number;
}

export function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className={`bg-[#161616] border border-[#2A2A2A] w-full ${wide ? 'max-w-2xl' : 'max-w-md'} p-6 space-y-4 max-h-[90vh] overflow-y-auto`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl text-white tracking-widest">{title}</h2>
          <button onClick={onClose} className="text-[#999] hover:text-white"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ChannelBadge({ channel }: { channel: ChatChannel }) {
  return (
    <span className="text-[10px] font-body font-medium tracking-widest uppercase px-1.5 py-0.5 border" style={{ color: CHANNEL_COLOR[channel], borderColor: `${CHANNEL_COLOR[channel]}55` }}>
      {CHANNEL_LABEL[channel]}
    </span>
  );
}

export function Cards({ cards }: { cards: MenuCard[] | null | undefined }) {
  if (!cards || cards.length === 0) return null;
  return (
    <div className="flex gap-2 mt-2 overflow-x-auto">
      {cards.map((c) => (
        <a key={c.url + c.name} href={c.url} target="_blank" rel="noreferrer" className="shrink-0 w-32 border border-[#2A2A2A] bg-[#0D0D0D] hover:border-[#555]">
          {c.imageUrl ? <img src={c.imageUrl} alt="" className="w-full h-20 object-cover" /> : <div className="w-full h-20 bg-[#1F1F1F]" />}
          <div className="p-1.5">
            <p className="text-white text-xs font-body leading-tight line-clamp-2">{c.name}</p>
            <p className="text-[#D62B2B] text-xs font-body mt-0.5">
              {taka(c.price)} {c.wasPrice != null && <span className="text-[#666] line-through ml-1">{taka(c.wasPrice)}</span>}
            </p>
          </div>
        </a>
      ))}
    </div>
  );
}

/** Short two-tone chime for new staff alerts. Browsers allow it after the first click on the page. */
export function chime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + i * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.18);
      osc.stop(ctx.currentTime + i * 0.18 + 0.32);
    });
    setTimeout(() => void ctx.close(), 1000);
  } catch {
    /* no sound available */
  }
}

/** Shrinks a photo in the browser before upload (longest side 1024 px, JPEG). */
export function shrinkPhoto(file: File, maxSide = 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that photo'));
    };
    img.src = url;
  });
}
