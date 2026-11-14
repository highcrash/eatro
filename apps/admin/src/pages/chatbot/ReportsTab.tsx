import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { api } from '../../lib/api';
import { CARD, CHANNEL_LABEL, ChatChannel, fmtTime, HINT, INPUT } from './shared';

interface Report {
  days: number;
  customerMessages: number;
  replies: Record<string, number>;
  answeredWithoutAiPercent: number;
  fallbackPercent: number;
  partyEnquiries: number;
  bookingRequests: number;
  waitingForStaff: number;
  byChannel: Partial<Record<ChatChannel, number>>;
  perDay: { day: string; messages: number }[];
  recentUnanswered: { question: string; reason: string; createdAt: string }[];
  complaints: { total: number; open: number; serious: number; byTopic: Record<string, number>; avgFirstResponseMins: number | null };
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className={`${CARD} p-4`}>
      <p className="text-[#666] text-xs font-body tracking-widest uppercase">{label}</p>
      <p className="font-display text-3xl text-white mt-1">{value}</p>
      {hint && <p className={HINT}>{hint}</p>}
    </div>
  );
}

export default function ReportsTab() {
  const [days, setDays] = useState(30);
  const { data } = useQuery<Report>({ queryKey: ['chat-report', days], queryFn: () => api.get(`/chatbot/report?days=${days}`) });
  if (!data) return null;
  const max = Math.max(1, ...data.perDay.map((d) => d.messages));
  const replies = Object.values(data.replies).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-6">
      <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={INPUT}>
        {[7, 30, 90].map((d) => <option key={d} value={d}>Last {d} days</option>)}
      </select>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat label="Customer messages" value={data.customerMessages} />
        <Stat label="Bot replies" value={replies} hint={`${data.replies.AI ?? 0} AI · ${data.replies.QUICK_REPLY ?? 0} pre-ready`} />
        <Stat label="Answered without AI" value={`${data.answeredWithoutAiPercent}%`} hint="Pre-ready answers, free" />
        <Stat label="Passed to staff" value={`${data.fallbackPercent}%`} hint={`${data.waitingForStaff} waiting now`} />
        <Stat label="Booking requests" value={data.bookingRequests} />
        <Stat label="Party enquiries" value={data.partyEnquiries} />
      </div>
      <div className={`${CARD} p-4`}>
        <p className="text-[#666] text-xs font-body tracking-widest uppercase mb-3">Customer messages per day</p>
        {data.perDay.length === 0 ? <p className={HINT}>No messages in this period.</p> : (
          <div className="flex items-end gap-1 h-32">
            {data.perDay.map((d) => (
              <div key={d.day} className="flex-1 bg-[#D62B2B]/70 hover:bg-[#D62B2B] min-w-[4px]" style={{ height: `${(d.messages / max) * 100}%` }} title={`${d.day}: ${d.messages}`} />
            ))}
          </div>
        )}
        <p className={`${HINT} mt-2`}>{Object.entries(data.byChannel).map(([c, n]) => `${CHANNEL_LABEL[c as ChatChannel]} ${n} chats`).join(' · ')}</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Complaints" value={data.complaints.total} hint={`${data.complaints.serious} serious`} />
        <Stat label="Still open" value={data.complaints.open} />
        <Stat label="Average first response" value={data.complaints.avgFirstResponseMins == null ? '—' : data.complaints.avgFirstResponseMins < 60 ? `${data.complaints.avgFirstResponseMins} min` : `${(data.complaints.avgFirstResponseMins / 60).toFixed(1)} h`} />
        <div className={`${CARD} p-4`}>
          <p className="text-[#666] text-xs font-body tracking-widest uppercase mb-1">By topic</p>
          {Object.keys(data.complaints.byTopic).length === 0 ? <p className={HINT}>None</p> : Object.entries(data.complaints.byTopic).sort((a, b) => b[1] - a[1]).map(([t, n]) => (
            <p key={t} className="text-sm font-body text-[#ccc]">{t.charAt(0) + t.slice(1).toLowerCase()}: {n}</p>
          ))}
        </div>
      </div>
      <div className={`${CARD} p-4 space-y-2`}>
        <p className="text-[#666] text-xs font-body tracking-widest uppercase">Recent questions the bot passed on</p>
        {data.recentUnanswered.length === 0 && <p className={HINT}>None.</p>}
        {data.recentUnanswered.map((u, i) => (
          <p key={i} className="text-sm font-body text-[#ccc]">{u.question || '(photo)'} <span className={HINT}>· {u.reason} · {fmtTime(u.createdAt)}</span></p>
        ))}
      </div>
    </div>
  );
}
