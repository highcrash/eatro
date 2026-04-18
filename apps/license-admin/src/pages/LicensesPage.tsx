import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban } from 'lucide-react';

import { api } from '../lib/api';
import { Button, Card, Input, Label, Badge, EmptyState } from '../components/ui';

interface License {
  id: string;
  product: { sku: string; name: string };
  purchaseCode: string;
  domain: string;
  fingerprint: string;
  status: 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'REVOKED';
  activatedAt: string | null;
  expiresAt: string | null;
  lastSeenAt: string | null;
  lastIp: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
}

interface PageResult {
  items: License[];
  total: number;
  page: number;
  pageSize: number;
}

export default function LicensesPage() {
  const qc = useQueryClient();
  const [productId, setProductId] = useState('');
  const [status, setStatus] = useState('');
  const [domain, setDomain] = useState('');
  const [page, setPage] = useState(1);

  const { data: products = [] } = useQuery({
    queryKey: ['admin', 'products'],
    queryFn: () => api.get<Array<{ id: string; name: string }>>('/admin/products'),
  });

  const query = new URLSearchParams({
    ...(productId ? { productId } : {}),
    ...(status ? { status } : {}),
    ...(domain ? { domain } : {}),
    page: String(page),
    pageSize: '50',
  }).toString();

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'licenses', query],
    queryFn: () => api.get<PageResult>(`/admin/licenses?${query}`),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.post(`/admin/licenses/${id}/revoke`, { reason: 'admin-revoked via UI' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'licenses'] });
      void qc.invalidateQueries({ queryKey: ['stats'] });
    },
  });

  return (
    <div>
      <h1 className="font-display text-4xl tracking-widest text-black-text mb-6">LICENSES</h1>

      <Card className="p-4 mb-4">
        <div className="grid grid-cols-4 gap-3">
          <div>
            <Label>Product</Label>
            <select
              value={productId}
              onChange={(e) => { setProductId(e.target.value); setPage(1); }}
              className="w-full border border-white-border px-3 py-2 text-sm font-body"
            >
              <option value="">All</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <Label>Status</Label>
            <select
              value={status}
              onChange={(e) => { setStatus(e.target.value); setPage(1); }}
              className="w-full border border-white-border px-3 py-2 text-sm font-body"
            >
              <option value="">All</option>
              <option value="ACTIVE">Active</option>
              <option value="PENDING">Pending</option>
              <option value="EXPIRED">Expired</option>
              <option value="REVOKED">Revoked</option>
            </select>
          </div>
          <div className="col-span-2">
            <Label>Domain contains</Label>
            <Input value={domain} onChange={(e) => { setDomain(e.target.value); setPage(1); }} placeholder="example.com" />
          </div>
        </div>
      </Card>

      {isLoading && <p className="text-sm font-body text-black-text/60">Loading…</p>}
      {data && data.items.length === 0 && <EmptyState title="No licenses" hint="Activated licenses show up here as buyers install their copies." />}

      {data && data.items.length > 0 && (
        <Card className="overflow-hidden">
          <table className="w-full text-sm font-body">
            <thead>
              <tr className="bg-white-soft text-left text-[11px] uppercase tracking-widest text-black-text/60">
                <th className="px-4 py-2 font-medium">Domain</th>
                <th className="px-4 py-2 font-medium">Product</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Activated</th>
                <th className="px-4 py-2 font-medium">Last Seen</th>
                <th className="px-4 py-2 font-medium">Last IP</th>
                <th className="px-4 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.id} className="border-t border-white-border">
                  <td className="px-4 py-2">
                    <p className="font-mono text-xs">{r.domain}</p>
                    <p className="text-[10px] text-black-text/40 font-mono truncate max-w-xs" title={r.fingerprint}>
                      {r.fingerprint.slice(0, 24)}…
                    </p>
                  </td>
                  <td className="px-4 py-2 text-black-text/60 text-xs">{r.product.name}</td>
                  <td className="px-4 py-2">
                    {r.status === 'ACTIVE' && <Badge tone="success">Active</Badge>}
                    {r.status === 'PENDING' && <Badge>Pending</Badge>}
                    {r.status === 'EXPIRED' && <Badge tone="warn">Expired</Badge>}
                    {r.status === 'REVOKED' && <Badge tone="danger">Revoked</Badge>}
                  </td>
                  <td className="px-4 py-2 text-black-text/60 text-xs">
                    {r.activatedAt ? new Date(r.activatedAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-2 text-black-text/60 text-xs">
                    {r.lastSeenAt ? new Date(r.lastSeenAt).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-2 text-black-text/60 text-xs font-mono">{r.lastIp ?? '—'}</td>
                  <td className="px-4 py-2 text-right">
                    {r.status !== 'REVOKED' && (
                      <button
                        className="text-red hover:text-red-bright text-xs inline-flex items-center gap-1"
                        onClick={() => {
                          if (confirm(`Revoke license for ${r.domain}? The activation slot will be returned to the purchase code.`)) {
                            revoke.mutate(r.id);
                          }
                        }}
                      >
                        <Ban size={12} /> Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex items-center justify-between px-4 py-3 border-t border-white-border text-xs font-body text-black-text/60">
            <span>
              {(page - 1) * data.pageSize + 1}-{Math.min(page * data.pageSize, data.total)} of {data.total}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setPage(page - 1)} disabled={page === 1}>Prev</Button>
              <Button size="sm" variant="outline" onClick={() => setPage(page + 1)} disabled={page * data.pageSize >= data.total}>Next</Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
