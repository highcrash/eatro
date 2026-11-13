import { Link } from 'react-router-dom';

import SEO from '../components/SEO';
import { useBranding } from '../lib/cms';
import { ContactLines } from './PrivacyPage';

export default function DataDeletionPage() {
  const { data: b } = useBranding();
  const name = b?.name ?? 'EATRO';
  return (
    <div>
      <SEO title={`${name} — Delete your data`} description={`How to ask ${name} to delete your information.`} />
      <section className="py-20 px-6 bg-card border-b border-border">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="font-display text-5xl md:text-6xl tracking-wider">DELETE YOUR DATA</h1>
          <p className="text-muted mt-3">How to ask us to remove your information</p>
        </div>
      </section>
      <div className="max-w-3xl mx-auto px-6 py-14 space-y-6 text-muted text-sm leading-relaxed">
        <p>You can ask {name} to delete the information we hold about you, including chat conversations from our website, Facebook Messenger, Instagram and WhatsApp.</p>
        <div className="space-y-2">
          <h2 className="font-display text-2xl tracking-wider text-text">1. Contact us</h2>
          <ContactLines />
        </div>
        <div className="space-y-2">
          <h2 className="font-display text-2xl tracking-wider text-text">2. Tell us who you are</h2>
          <p>
            Include the phone number you used with us, or your Facebook, Instagram or WhatsApp name, and say "Please delete my data". So that nobody else can delete your
            records, we may ask you to confirm from that phone number or account.
          </p>
        </div>
        <div className="space-y-2">
          <h2 className="font-display text-2xl tracking-wider text-text">3. What happens next</h2>
          <p>
            We delete your chat conversations and remove you from our customer and marketing lists within 30 days, and confirm when it is done. Records we must keep for tax
            and accounting, such as past bills, are kept without being used for marketing.
          </p>
          <p>Chats are also deleted automatically after a set period. See our <Link to="/privacy" className="text-accent underline">privacy policy</Link>.</p>
        </div>
        <div className="space-y-2">
          <h2 className="font-display text-2xl tracking-wider text-text">If you connected through Facebook</h2>
          <p>
            You can also remove our app from your Facebook account in Facebook Settings, under Apps and Websites. That stops new data reaching us; contact us as above to delete
            what we already have.
          </p>
        </div>
      </div>
    </div>
  );
}
