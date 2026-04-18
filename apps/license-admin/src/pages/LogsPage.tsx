import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { api } from '../lib/api';
import { Button, Card, Input, Label, Badge, EmptyState } from '../components/ui';

interface LogRow {
  id: string;
  at: string;
  action: 'ACTIVATE' | 'VERIFY' | 'DEACTIVATE' | 'BLOCKED' | 'ROTATE';
  result: string;
  licenseId: string | null;
  productId: string | null;
  ip: string | null;
  userAgent: string | null;
  detail: Record<string, unknown> | null;
}

interface PageResult {
  items: LogRow[];
  total: number;
  page: number;
  pageSize: number;
}

const ACTION_TONE: Record<LogRow['action'], 'neutral' | 'success' | 'warn' | 'danger'> = {
  ACTIVATE: 'success',
  VERIFY: 'neutral',
  DEACTIVATE: 'warn',
  BLOCKED: 'danger',
  ROTATE: 'warn',
};

export default function LogsPage() {
  const [action, setAction] = useState('');
  const [ip, setIp] = useState('');
  const [licenseId, setLicenseId] = useState('');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  const query = new URLSearchParams({
    ...(action ? { action } : {}),
    ...(ip ? { ip } : {}),
    ...(licenseId ? { licenseId } : {}),
    page: String(page),
    pageSize: '100',
  }).toString();

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'logs', query],
    queryFn: () => api.get<PageResult>(`/admin/logs?${query}`),
    refetchInterval: 30_000,
  });

  return (
    <div>
      <h1 className="font-display text-4xl tracking-widest text-black-text mb-6">LOGS</h1>

      <Card className="p-4 mb-4">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label>Action</Label>
            <select
              value={action}
              onChange={(e) => { setAction(e.target.value); setPage(1); }}
              className="w-full border border-white-border px-3 py-2 text-sm font-body"
            >
              <option value="">All</option>
              <option value="ACTIVATE">Activate</option>
              <option value="VERIFY">Verify</option>
              <option value="DEACTIVATE">Deactivate</option>
              <option value="BLOCKED">Blocked</option>
              <option value="ROTATE">Rotate</option>
            </select>
          </div>
          <div>
            <Label>IP</Label>
            <Input value={ip} onChange={(e) => { setIp(e.target.value); setPage(1); }} placeholder="203.0.113.42" />
          </div>
          <div>
            <Label>License ID</Label>
            <Input value={licenseId} onChange={(e) => { setLicenseId(e.target.value); setPage(1); }} placeholder="cmo…" />
          </div>
        </div>
      </Card>

      {isLoading && <p className="text-sm font-body text-black-text/60">Loading…</p>}
      {data && data.items.length === 0 && <EmptyState title="No logs match" hint="Every activate / verify / deactivate is logged here." />}

      {data && data.items.length > 0 && (
        <Card className="overflow-hidden">
          <table className="w-full text-sm font-body">
            <thead>
              <tr className="bg-white-soft text-left text-[11px] uppercase tracking-widest text-black-text/60">
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">Action</th>
                <th className="px-4 py-2 font-medium">Result</th>
                <th className="px-4 py-2 font-medium">IP</th>
                <th className="px-4 py-2 font-medium">License</th>
                <th className="px-4 py-2 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <>
                  <tr key={r.id} className="border-t border-white-border">
                    <td className="px-4 py-2 text-xs text-black-text/60">{new Date(r.at).toLocaleString()}</td>
                    <td className="px-4 py-2"><Badge tone={ACTION_TONE[r.action]}>{r.action}</Badge></td>
                    <td className="px-4 py-2">
                      <code className={`text-xs font-mono ${r.result === 'OK' ? 'text-green' : 'text-red'}`}>{r.result}</code>
                    </td>
                    <td className="px-4 py-2 text-xs font-mono text-black-text/60">{r.ip ?? '—'}</td>
                    <td className="px-4 py-2 text-xs font-mono text-black-text/60">
                      {r.licenseId ? r.licenseId.slice(0, 12) + '…' : '—'}
                    </td>
                    <td className="px-4 py-2">
                      {r.detail && (
                        <button
                          onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                          className="text-xs text-black-text/60 hover:text-black-text underline"
                        >
                          {expanded === r.id ? 'Hide' : 'Show'}
                        </button>
                      )}
                    </td>
                  </tr>
                  {expanded === r.id && r.detail && (
                    <tr className="bg-white-soft">
                      <td colSpan={6} className="px-4 py-2">
                        <pre className="text-[10px] font-mono overflow-auto">{JSON.stringify(r.detail, null, 2)}</pre>
                        {r.userAgent && <p className="text-[10px] font-mono text-black-text/50 mt-1">UA: {r.userAgent}</p>}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>

          <div className="flex items-center justify-between px-4 py-3 border-t border-white-border text-xs font-body text-black-text/60">
            <span>
              {(page - 1) * data.pageSize + 1}-{Math.min(page * data.pageSize, data.total)} of {data.total} · refreshes every 30s
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
