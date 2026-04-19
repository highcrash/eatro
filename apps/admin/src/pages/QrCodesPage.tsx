import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

interface DiningTable {
  id: string;
  tableNumber: string;
  capacity: number;
  status: string;
  deletedAt?: string | null;
}

// Public base URL for the customer-facing QR ordering app. Override via
// VITE_QR_BASE_URL at build time (set to http://localhost:5176 locally,
// https://qr.example.com in production).
const QR_BASE_URL =
  ((import.meta as any).env?.VITE_QR_BASE_URL as string | undefined) ??
  'https://qr.example.com';

export default function QrCodesPage() {
  const [copied, setCopied] = useState<string | null>(null);

  const { data: tables = [], isLoading } = useQuery<DiningTable[]>({
    queryKey: ['tables'],
    queryFn: () => api.get('/tables'),
  });

  const copyLink = (tableId: string) => {
    const url = `${QR_BASE_URL}/table/${tableId}`;
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(tableId);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const openQr = (tableId: string) => {
    window.open(`${QR_BASE_URL}/table/${tableId}`, '_blank');
  };

  const activeTables = tables.filter((t) => !t.deletedAt);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl text-white tracking-widest">QR CODES</h1>
          <p className="text-[#666] font-body text-sm mt-1">
            Share these links or QR codes with customers to enable self-ordering.
            QR app runs at{' '}
            <span className="text-[#999] font-mono text-xs">{QR_BASE_URL}</span>
          </p>
        </div>
      </div>

      {isLoading ? (
        <p className="text-[#666] font-body text-sm">Loading…</p>
      ) : activeTables.length === 0 ? (
        <div className="text-center py-16 text-[#999] font-body text-sm border border-[#2A2A2A] bg-[#161616]">
          No tables found. Create tables in the Tables section first.
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {activeTables.map((table) => {
            const url = `${QR_BASE_URL}/table/${table.id}`;
            return (
              <div key={table.id} className="bg-[#161616] border border-[#2A2A2A] p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <p className="font-display text-white text-3xl tracking-widest">T{table.tableNumber}</p>
                    <p className="text-[#999] font-body text-xs">{table.capacity} seats</p>
                  </div>
                  <span
                    className={`text-xs font-body px-2 py-0.5 ${
                      table.status === 'AVAILABLE'
                        ? 'bg-[#e8f5e9] text-[#2e7d32]'
                        : table.status === 'OCCUPIED'
                        ? 'bg-[#fce4e4] text-[#D62B2B]'
                        : 'bg-[#F2F1EE] text-[#666]'
                    }`}
                  >
                    {table.status}
                  </span>
                </div>

                {/* URL display */}
                <div className="bg-[#FAF9F7] border border-[#2A2A2A] p-3 mb-4">
                  <p className="text-[#666] font-mono text-xs break-all">{url}</p>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => copyLink(table.id)}
                    className={`flex-1 font-body text-xs tracking-widest uppercase py-2 transition-colors ${
                      copied === table.id
                        ? 'bg-[#2e7d32] text-white'
                        : 'bg-[#F2F1EE] hover:bg-[#E8E6E2] text-[#666] hover:text-white'
                    }`}
                  >
                    {copied === table.id ? 'Copied!' : 'Copy Link'}
                  </button>
                  <button
                    onClick={() => openQr(table.id)}
                    className="flex-1 bg-[#D62B2B] hover:bg-[#F03535] text-white font-body text-xs tracking-widest uppercase py-2 transition-colors"
                  >
                    Open
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
