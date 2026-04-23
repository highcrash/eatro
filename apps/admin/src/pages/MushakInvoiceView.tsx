import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { renderMushakSlipHtml, type MushakSnapshot } from '@restora/utils';
import { api } from '../lib/api';

/**
 * Standalone reprint view for a single Mushak-6.3 (invoice) or 6.8 (note).
 *
 * The frozen `snapshot` JSON stored on the row holds every field the NBR
 * layout needs — we never rebuild it from live data. Clicking Print opens
 * the same 80mm HTML template used by the POS popup path.
 *
 * Routes:
 *   /mushak/invoices/:id
 *   /mushak/notes/:id
 */
export default function MushakInvoiceView() {
  const params = useParams<{ id: string; kind?: string }>();
  // The route file wires this to both paths with different params.kind
  // fallbacks; detect by URL so the component works for either.
  const isNote = typeof window !== 'undefined' && window.location.pathname.includes('/mushak/notes/');
  const id = params.id!;

  const endpoint = isNote ? `/mushak/notes/${id}` : `/mushak/invoices/${id}`;
  const { data, isLoading, error } = useQuery<{ snapshot: MushakSnapshot; serial: string }>({
    queryKey: ['mushak-doc', endpoint],
    queryFn: () => api.get(endpoint),
  });

  useEffect(() => {
    // Auto-focus print on load — but only once the data is ready.
    if (data?.snapshot) {
      const html = renderMushakSlipHtml(data.snapshot as MushakSnapshot);
      // Replace the current document so the browser print dialog targets
      // the slip, not the admin chrome.
      const w = window.open('', '_self', '');
      if (w) {
        w.document.open();
        w.document.write(html);
        w.document.close();
      }
    }
  }, [data]);

  if (isLoading) return <div className="p-6 font-body text-[#999]">Loading Mushak document…</div>;
  if (error) return <div className="p-6 font-body text-[#D62B2B]">Failed to load: {(error as Error).message}</div>;
  if (!data) return null;
  return (
    <div className="p-6 font-body text-[#999]">
      Opening print preview for <span className="text-white font-mono">{data.serial}</span>…
    </div>
  );
}
