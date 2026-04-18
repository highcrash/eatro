import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RotateCw, Copy } from 'lucide-react';

import { api } from '../lib/api';
import { Button, Card, Input, Label, EmptyState } from '../components/ui';

interface Product {
  id: string;
  sku: string;
  name: string;
  version: string;
  description: string | null;
  envatoItemId: string | null;
  envatoLastSyncedAt: string | null;
  createdAt: string;
  counts: { purchaseCodes: number; licenses: number; signingKeys: number };
  activeKey: { kid: string; ed25519PublicKey: string; createdAt: string } | null;
}

export default function ProductsPage() {
  const qc = useQueryClient();
  const { data: products = [], isLoading } = useQuery({
    queryKey: ['admin', 'products'],
    queryFn: () => api.get<Product[]>('/admin/products'),
  });

  const [showCreate, setShowCreate] = useState(false);

  return (
    <div>
      <header className="flex items-center justify-between mb-6">
        <h1 className="font-display text-4xl tracking-widest text-black-text">PRODUCTS</h1>
        <Button onClick={() => setShowCreate(true)}>
          <Plus size={14} /> New product
        </Button>
      </header>

      {isLoading && <p className="text-sm font-body text-black-text/60">Loading…</p>}

      {!isLoading && products.length === 0 && (
        <EmptyState title="No products yet" hint="Create your first product to start issuing licenses." />
      )}

      {products.length > 0 && (
        <div className="space-y-3">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} onRotated={() => qc.invalidateQueries({ queryKey: ['admin', 'products'] })} />
          ))}
        </div>
      )}

      {showCreate && <CreateDialog onClose={() => setShowCreate(false)} />}
    </div>
  );
}

function ProductCard({ product, onRotated }: { product: Product; onRotated: () => void }) {
  const rotate = useMutation({
    mutationFn: () => api.post<{ kid: string; publicKey: string; previousKid: string | null }>(`/admin/products/${product.id}/rotate-key`),
    onSuccess: onRotated,
  });

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1">
            <p className="font-display text-2xl tracking-widest text-black-text">{product.name}</p>
            <code className="text-[11px] font-mono text-black-text/60 bg-white-soft px-2 py-0.5">{product.sku}</code>
            <span className="text-[11px] font-body text-black-text/60">v{product.version}</span>
          </div>
          {product.description && <p className="text-sm text-black-text/60 font-body mb-3">{product.description}</p>}

          <div className="flex items-center gap-6 text-xs font-body text-black-text/60">
            <span>{product.counts.purchaseCodes} purchase codes</span>
            <span>{product.counts.licenses} licenses</span>
            <span>{product.counts.signingKeys} signing keys</span>
          </div>

          {product.activeKey && (
            <div className="mt-3 pt-3 border-t border-white-border">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] uppercase tracking-widest font-body text-black-text/50">Active signing key</span>
                <code className="text-[11px] font-mono bg-white-soft px-2 py-0.5">kid: {product.activeKey.kid}</code>
              </div>
              <div className="flex items-center gap-2">
                <code className="text-[10px] font-mono text-black-text/50 truncate flex-1">{product.activeKey.ed25519PublicKey}</code>
                <button
                  onClick={() => void navigator.clipboard.writeText(product.activeKey!.ed25519PublicKey)}
                  className="text-black-text/40 hover:text-black-text"
                  title="Copy public key"
                >
                  <Copy size={12} />
                </button>
              </div>
            </div>
          )}
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (confirm('Rotate signing key? The old key stays valid for 30 days so existing clients can keep verifying.')) {
              rotate.mutate();
            }
          }}
          disabled={rotate.isPending}
        >
          <RotateCw size={12} /> Rotate key
        </Button>
      </div>
    </Card>
  );
}

function CreateDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [description, setDescription] = useState('');
  const [envatoItemId, setEnvatoItemId] = useState('');
  const [created, setCreated] = useState<{ activeKey: { kid: string; publicKey: string } } | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api.post<{ id: string; sku: string; activeKey: { kid: string; publicKey: string } }>('/admin/products', {
        sku,
        name,
        version,
        description: description || undefined,
        envatoItemId: envatoItemId || undefined,
      }),
    onSuccess: (row) => {
      setCreated(row);
      void qc.invalidateQueries({ queryKey: ['admin', 'products'] });
    },
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <Card className="w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        {!created ? (
          <>
            <h2 className="font-display text-2xl tracking-widest mb-4">NEW PRODUCT</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                create.mutate();
              }}
              className="space-y-3"
            >
              <div>
                <Label>SKU (lowercase, no spaces)</Label>
                <Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="restora-pos-cc" required />
              </div>
              <div>
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Restora POS CodeCanyon" required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Version</Label>
                  <Input value={version} onChange={(e) => setVersion(e.target.value)} required />
                </div>
                <div>
                  <Label>Envato item ID (optional)</Label>
                  <Input value={envatoItemId} onChange={(e) => setEnvatoItemId(e.target.value)} placeholder="12345678" />
                </div>
              </div>
              <div>
                <Label>Description (optional)</Label>
                <Input value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>

              {create.isError && <p className="text-sm text-red font-body">{(create.error as Error).message}</p>}

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
                <Button type="submit" disabled={create.isPending || !sku || !name || !version}>
                  {create.isPending ? 'Creating…' : 'Create'}
                </Button>
              </div>
            </form>
          </>
        ) : (
          <>
            <h2 className="font-display text-2xl tracking-widest mb-2 text-green">PRODUCT CREATED</h2>
            <p className="text-sm font-body text-black-text/60 mb-4">
              Copy the public key + kid below into your client build — clients verify proofs against this key.
              Keep them somewhere safe; they're also retrievable later from this product's row.
            </p>
            <div className="bg-white-soft p-3 mb-4">
              <p className="text-[10px] uppercase tracking-widest font-body text-black-text/50 mb-1">kid</p>
              <code className="text-sm font-mono">{created.activeKey.kid}</code>
            </div>
            <div className="bg-white-soft p-3 mb-6">
              <p className="text-[10px] uppercase tracking-widest font-body text-black-text/50 mb-1">Public key (base64url)</p>
              <code className="text-xs font-mono break-all">{created.activeKey.publicKey}</code>
            </div>
            <Button onClick={onClose} className="w-full justify-center">Done</Button>
          </>
        )}
      </Card>
    </div>
  );
}
