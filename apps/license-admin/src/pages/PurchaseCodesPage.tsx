import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Ban, Copy } from 'lucide-react';

import { api } from '../lib/api';
import { Button, Card, Input, Label, Badge, EmptyState } from '../components/ui';

interface Product { id: string; sku: string; name: string }

interface PurchaseCode {
  id: string;
  code: string;
  source: 'IMPORTED' | 'MANUAL' | 'GRANT';
  maxActivations: number;
  usedActivations: number;
  isRevoked: boolean;
  revokedReason: string | null;
  envatoBuyer: string | null;
  notes: string | null;
  createdAt: string;
  product: { sku: string; name: string };
  licenseCount: number;
}

interface PageResult {
  items: PurchaseCode[];
  total: number;
  page: number;
  pageSize: number;
}

export default function PurchaseCodesPage() {
  const qc = useQueryClient();
  const [productId, setProductId] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showIssue, setShowIssue] = useState(false);

  const { data: products = [] } = useQuery({
    queryKey: ['admin', 'products'],
    queryFn: () => api.get<Array<Product & { counts: unknown; activeKey: unknown }>>('/admin/products'),
  });

  const queryString = new URLSearchParams({
    ...(productId ? { productId } : {}),
    ...(status ? { status } : {}),
    ...(search ? { search } : {}),
    page: String(page),
    pageSize: '50',
  }).toString();

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'purchase-codes', queryString],
    queryFn: () => api.get<PageResult>(`/admin/purchase-codes?${queryString}`),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.post(`/admin/purchase-codes/${id}/revoke`, { reason: 'admin action' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'purchase-codes'] }),
  });

  return (
    <div>
      <header className="flex items-center justify-between mb-6">
        <h1 className="font-display text-4xl tracking-widest text-black-text">PURCHASE CODES</h1>
        <Button onClick={() => setShowIssue(true)}>
          <Plus size={14} /> Issue code
        </Button>
      </header>

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
              <option value="UNUSED">Unused</option>
              <option value="EXHAUSTED">Exhausted</option>
              <option value="REVOKED">Revoked</option>
            </select>
          </div>
          <div className="col-span-2">
            <Label>Search (code suffix)</Label>
            <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="e.g. 4XYZ" />
          </div>
        </div>
      </Card>

      {isLoading && <p className="text-sm font-body text-black-text/60">Loading…</p>}

      {data && data.items.length === 0 && (
        <EmptyState title="No codes" hint="Issue one above or adjust your filters." />
      )}

      {data && data.items.length > 0 && (
        <Card className="overflow-hidden">
          <table className="w-full text-sm font-body">
            <thead>
              <tr className="bg-white-soft text-left text-[11px] uppercase tracking-widest text-black-text/60">
                <th className="px-4 py-2 font-medium">Code</th>
                <th className="px-4 py-2 font-medium">Product</th>
                <th className="px-4 py-2 font-medium">Source</th>
                <th className="px-4 py-2 font-medium">Slots</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Created</th>
                <th className="px-4 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.id} className="border-t border-white-border">
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <code className="font-mono text-xs">{r.code}</code>
                      <button
                        onClick={() => void navigator.clipboard.writeText(r.code)}
                        className="text-black-text/40 hover:text-black-text"
                      >
                        <Copy size={12} />
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-2 text-black-text/60">{r.product.name}</td>
                  <td className="px-4 py-2"><Badge>{r.source}</Badge></td>
                  <td className="px-4 py-2">
                    {r.usedActivations}/{r.maxActivations}
                  </td>
                  <td className="px-4 py-2">
                    {r.isRevoked
                      ? <Badge tone="danger">Revoked</Badge>
                      : r.usedActivations >= r.maxActivations
                      ? <Badge tone="warn">Exhausted</Badge>
                      : r.usedActivations > 0
                      ? <Badge tone="success">In use</Badge>
                      : <Badge>Unused</Badge>}
                  </td>
                  <td className="px-4 py-2 text-black-text/60 text-xs">
                    {new Date(r.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {!r.isRevoked && (
                      <button
                        className="text-red hover:text-red-bright text-xs inline-flex items-center gap-1"
                        onClick={() => {
                          if (confirm(`Revoke ${r.code}?`)) revoke.mutate(r.id);
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

      {showIssue && <IssueDialog products={products} onClose={() => setShowIssue(false)} />}
    </div>
  );
}

function IssueDialog({ products, onClose }: { products: Array<Product>; onClose: () => void }) {
  const qc = useQueryClient();
  const [productId, setProductId] = useState(products[0]?.id ?? '');
  const [source, setSource] = useState<'MANUAL' | 'GRANT'>('MANUAL');
  const [maxActivations, setMaxActivations] = useState(1);
  const [notes, setNotes] = useState('');
  const [code, setCode] = useState('');
  const [issued, setIssued] = useState<{ code: string } | null>(null);

  const issue = useMutation({
    mutationFn: () =>
      api.post<{ code: string }>('/admin/purchase-codes', {
        productId,
        source,
        maxActivations,
        notes: notes || undefined,
        code: code || undefined,
      }),
    onSuccess: (row) => {
      setIssued(row);
      void qc.invalidateQueries({ queryKey: ['admin', 'purchase-codes'] });
    },
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <Card className="w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        {!issued ? (
          <>
            <h2 className="font-display text-2xl tracking-widest mb-4">ISSUE CODE</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                issue.mutate();
              }}
              className="space-y-3"
            >
              <div>
                <Label>Product</Label>
                <select
                  value={productId}
                  onChange={(e) => setProductId(e.target.value)}
                  required
                  className="w-full border border-white-border px-3 py-2 text-sm font-body"
                >
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Source</Label>
                  <select
                    value={source}
                    onChange={(e) => setSource(e.target.value as 'MANUAL' | 'GRANT')}
                    className="w-full border border-white-border px-3 py-2 text-sm font-body"
                  >
                    <option value="MANUAL">Manual (sale)</option>
                    <option value="GRANT">Grant (comp)</option>
                  </select>
                </div>
                <div>
                  <Label>Max activations</Label>
                  <Input type="number" min={1} max={1000} value={maxActivations} onChange={(e) => setMaxActivations(Number(e.target.value))} />
                </div>
              </div>
              <div>
                <Label>Custom code (optional — leave blank to auto-generate)</Label>
                <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="PROMO-CODE-123" />
              </div>
              <div>
                <Label>Notes</Label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Beta tester, etc." />
              </div>

              {issue.isError && <p className="text-sm text-red font-body">{(issue.error as Error).message}</p>}

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
                <Button type="submit" disabled={issue.isPending || !productId}>
                  {issue.isPending ? 'Issuing…' : 'Issue'}
                </Button>
              </div>
            </form>
          </>
        ) : (
          <>
            <h2 className="font-display text-2xl tracking-widest mb-2 text-green">CODE ISSUED</h2>
            <p className="text-sm font-body text-black-text/60 mb-4">Share this with the buyer.</p>
            <div className="bg-white-soft p-4 mb-6">
              <code className="text-lg font-mono break-all">{issued.code}</code>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => void navigator.clipboard.writeText(issued.code)} className="flex-1 justify-center">
                <Copy size={12} /> Copy
              </Button>
              <Button onClick={onClose} className="flex-1 justify-center">Done</Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
