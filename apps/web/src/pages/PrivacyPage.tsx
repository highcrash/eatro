import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import SEO from '../components/SEO';
import { api } from '../lib/api';
import { getActiveBranchId, useBranding } from '../lib/cms';

function useRetentionDays() {
  const branchId = getActiveBranchId();
  const { data } = useQuery<{ retentionDays: number }>({
    queryKey: ['chat-config', branchId],
    queryFn: () => api.getJson(`/public/chatbot/config?branchId=${encodeURIComponent(branchId)}`),
    staleTime: 5 * 60_000,
    retry: false,
  });
  return data?.retentionDays ?? 90;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="font-display text-2xl tracking-wider">{title}</h2>
      <div className="text-muted leading-relaxed space-y-3 text-sm">{children}</div>
    </section>
  );
}

export function ContactLines() {
  const { data: b } = useBranding();
  return (
    <ul className="list-disc pl-5 space-y-1">
      {b?.phone && <li>Phone: <a href={`tel:${b.phone}`} className="text-accent">{b.phone}</a></li>}
      {b?.email && <li>Email: <a href={`mailto:${b.email}`} className="text-accent">{b.email}</a></li>}
      {b?.address && <li>In person: {b.address}</li>}
      <li>A message to our Facebook Page, Instagram account or WhatsApp number</li>
    </ul>
  );
}

export default function PrivacyPage() {
  const { data: b } = useBranding();
  const name = b?.name ?? 'EATRO';
  const days = useRetentionDays();

  return (
    <div>
      <SEO title={`${name} — Privacy Policy`} description={`How ${name} handles your information when you book, order or chat with us.`} />
      <section className="py-20 px-6 bg-card border-b border-border">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="font-display text-5xl md:text-6xl tracking-wider">PRIVACY POLICY</h1>
          <p className="text-muted mt-3">How {name} uses the information you share with us</p>
        </div>
      </section>
      <div className="max-w-3xl mx-auto px-6 py-14 space-y-10">
        <Section title="What we collect">
          <p>We collect only what we need to serve you:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Your name and phone number when you book a table, order, join our loyalty or membership programme, or give them to us in a chat.</li>
            <li>Booking details: date, time, number of guests and any notes.</li>
            <li>Your orders and visits, so we can apply loyalty points, membership discounts and keep receipts.</li>
            <li>Messages you send us on our website chat, Facebook Messenger, Instagram or WhatsApp, including photos you choose to send.</li>
            <li>Basic website usage data through Facebook Pixel and Google Analytics when they are enabled, to understand which pages are visited.</li>
          </ul>
        </Section>

        <Section title="Our chat assistant">
          <p>
            Messages on our website chat, and on Messenger, Instagram and WhatsApp once those are connected, may be answered first by our automated assistant. It replies about
            our menu, prices, offers, opening hours and bookings, and a member of our team can join the conversation at any time.
          </p>
          <p>
            To write a reply, the text of your message and the recent conversation are sent to an artificial intelligence (AI) service provider. Phone numbers are removed by our
            system before anything is sent. If photo recognition is switched on and you send a photo, the photo is sent to the AI provider too. These providers process the
            message to produce a reply and may keep it under their own policies; some free providers may use it to improve their services. Please don't send payment details,
            passwords or other sensitive information in chat.
          </p>
          <p>Prices in automated replies are checked against our live menu. Party quotes are estimates until our team confirms them.</p>
        </Section>

        <Section title="How we use it">
          <ul className="list-disc pl-5 space-y-1">
            <li>To answer your questions, arrange bookings and parties, and serve your orders.</li>
            <li>To send booking confirmations, reminders and receipts by SMS.</li>
            <li>To apply loyalty points, coupons and membership discounts.</li>
            <li>To improve our food, service and answers, for example by reviewing questions our assistant could not answer.</li>
          </ul>
          <p>We do not sell your information.</p>
        </Section>

        <Section title="Who we share it with">
          <ul className="list-disc pl-5 space-y-1">
            <li>Meta (Facebook, Instagram, WhatsApp), when you message us through their apps.</li>
            <li>The AI provider that writes chat replies, as described above.</li>
            <li>Our SMS provider, to deliver booking and order messages.</li>
            <li>Our hosting provider, which stores our systems.</li>
          </ul>
        </Section>

        <Section title="How long we keep it">
          <p>Chat conversations are deleted automatically {days} days after the last message. Booking, order and customer records are kept for our business and tax records.</p>
        </Section>

        <Section title="Your choices">
          <p>
            You can ask to see, correct or delete your information at any time. See <Link to="/data-deletion" className="text-accent underline">how to delete your data</Link>, or
            contact us:
          </p>
          <ContactLines />
        </Section>
      </div>
    </div>
  );
}
