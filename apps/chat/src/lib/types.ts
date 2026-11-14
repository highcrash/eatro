export type Channel = 'WEB' | 'MESSENGER' | 'INSTAGRAM' | 'WHATSAPP';

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
}

export interface ConversationSummary {
  id: string;
  channel: Channel;
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

export interface CustomerCard {
  id: string;
  name: string;
  phone: string;
  totalOrders: number;
  totalSpent: number;
  lastVisit: string | null;
  loyaltyPoints: number;
  customerSince: string;
  upcoming: { id: string; date: string; timeSlot: string; partySize: number; status: string }[];
}

export interface ChatLead { id: string; guests: number; date: string | null; time: string | null; occasion: string | null; status: string }

export interface ConversationDetail extends Omit<ConversationSummary, 'lastMessage' | 'drafts'> {
  humanUntil: string | null;
  phoneVerifiedAt?: string | null;
  messages: ChatMessage[];
  leads: ChatLead[];
  customer: CustomerCard | null;
}

export interface Comment {
  id: string;
  platform: 'FACEBOOK' | 'INSTAGRAM';
  authorName: string | null;
  text: string;
  kind: string;
  status: 'NEW' | 'DRAFT' | 'REPLIED' | 'ESCALATED' | 'IGNORED' | 'HIDDEN';
  draftPublicReply: string | null;
  draftPrivateReply: string | null;
  publicReply: string | null;
  privateReplySent: boolean;
  hidden: boolean;
  lastError: string | null;
  createdAt: string;
  post: { caption: string | null; permalink: string | null } | null;
}

export type ComplaintLevel = 'SERIOUS' | 'ORDINARY' | 'MILD';
export type ComplaintStatus = 'NEW' | 'CONTACTED' | 'RESOLVED';

export interface Complaint {
  id: string;
  source: 'COMMENT' | 'CHAT';
  channel: string | null;
  customerName: string | null;
  customerPhone: string | null;
  text: string;
  level: ComplaintLevel;
  topic: string;
  status: ComplaintStatus;
  draftReply: string | null;
  notes: string | null;
  outcome: string | null;
  openedAt: string | null;
  createdAt: string;
  conversationId: string | null;
}

export interface ComplaintDetail extends Complaint {
  comment: { publicReply: string | null; privateReplySent: boolean; draftPublicReply: string | null; draftPrivateReply: string | null } | null;
  recentOrders: { id: string; orderNumber: string; createdAt: string; totalAmount: number; status: string; items: { menuItemName: string; quantity: number }[] }[];
}

export const CHANNEL_LABEL: Record<Channel, string> = { WEB: 'Website', MESSENGER: 'Messenger', INSTAGRAM: 'Instagram', WHATSAPP: 'WhatsApp' };
export const CHANNEL_COLOR: Record<Channel, string> = { WEB: '#6F6F6F', MESSENGER: '#0866FF', INSTAGRAM: '#C13584', WHATSAPP: '#1FA855' };

export function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export const taka = (n: number) => `৳${Math.round(n).toLocaleString('en-IN')}`;
