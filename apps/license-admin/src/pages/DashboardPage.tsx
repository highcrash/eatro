import { useQuery } from '@tanstack/react-query';
import { Package, Key, ShieldCheck, ShieldOff, AlertTriangle, Ban } from 'lucide-react';
import type { ReactNode } from 'react';

import { api } from '../lib/api';
import { Card } from '../components/ui';

interface Stats {
  products: number;
  purchaseCodes: number;
  purchaseCodesUnused: number;
  licensesActive: number;
  licensesRevoked: number;
  failedActivates7d: number;
  blockedIps24h: number;
}

export default function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['stats'],
    queryFn: () => api.get<Stats>('/admin/stats'),
  });

  return (
    <div>
      <h1 className="font-display text-4xl tracking-widest text-black-text mb-6">DASHBOARD</h1>

      {isLoading && <p className="text-sm font-body text-black-text/60">Loading…</p>}

      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat icon={<Package size={18} />} label="Products" value={data.products} />
          <Stat icon={<Key size={18} />} label="Purchase Codes" value={data.purchaseCodes} sub={`${data.purchaseCodesUnused} unused`} />
          <Stat icon={<ShieldCheck size={18} />} label="Active Licenses" value={data.licensesActive} tone="success" />
          <Stat icon={<ShieldOff size={18} />} label="Revoked Licenses" value={data.licensesRevoked} />
          <Stat icon={<AlertTriangle size={18} />} label="Failed Activates (7d)" value={data.failedActivates7d} tone={data.failedActivates7d > 10 ? 'warn' : 'neutral'} />
          <Stat icon={<Ban size={18} />} label="Blocked IPs (24h)" value={data.blockedIps24h} tone={data.blockedIps24h > 0 ? 'danger' : 'neutral'} />
        </div>
      )}
    </div>
  );
}

function Stat({
  icon, label, value, sub, tone = 'neutral',
}: {
  icon: ReactNode;
  label: string;
  value: number;
  sub?: string;
  tone?: 'neutral' | 'success' | 'warn' | 'danger';
}) {
  const toneClasses = {
    neutral: 'text-black-text',
    success: 'text-green',
    warn: 'text-amber',
    danger: 'text-red',
  };
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 text-black-text/60 mb-2">
        {icon}
        <p className="text-[10px] uppercase tracking-widest font-body">{label}</p>
      </div>
      <p className={`font-display text-4xl tracking-wider ${toneClasses[tone]}`}>{value}</p>
      {sub && <p className="text-xs text-black-text/60 font-body mt-1">{sub}</p>}
    </Card>
  );
}
