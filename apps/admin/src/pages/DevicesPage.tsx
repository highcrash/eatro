import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Monitor, Power, Pencil, Check, X } from 'lucide-react';
import { useState } from 'react';

interface Device {
  id: string;
  name: string;
  isActive: boolean;
  lastSeenAt: string | null;
  createdAt: string;
  revokedAt: string | null;
  createdById: string | null;
}

const ONLINE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

function formatRelative(iso: string | null): string {
  if (!iso) return 'Never';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'Just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return new Date(iso).toLocaleDateString();
}

function isOnline(d: Device): boolean {
  if (!d.isActive || !d.lastSeenAt) return false;
  return Date.now() - new Date(d.lastSeenAt).getTime() < ONLINE_THRESHOLD_MS;
}

export default function DevicesPage() {
  const qc = useQueryClient();
  const { data: devices = [], isLoading } = useQuery<Device[]>({
    queryKey: ['devices'],
    queryFn: () => api.get('/devices'),
    refetchInterval: 30_000,
  });

  const revokeMut = useMutation({
    mutationFn: (id: string) => api.delete(`/devices/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['devices'] }),
  });

  const renameMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.patch(`/devices/${id}`, { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['devices'] }),
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');

  const startEdit = (d: Device) => {
    setEditingId(d.id);
    setDraftName(d.name);
  };

  const commitEdit = () => {
    if (editingId && draftName.trim()) {
      renameMut.mutate({ id: editingId, name: draftName.trim() });
    }
    setEditingId(null);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-8 py-5 border-b border-[#2A2A2A]">
        <p className="text-[#D62B2B] text-xs font-body font-medium tracking-widest uppercase">Owner only</p>
        <h1 className="font-display text-white text-4xl tracking-wide flex items-center gap-3">
          <Monitor size={28} /> PAIRED TERMINALS
        </h1>
        <p className="text-[#888] text-sm font-body mt-2 max-w-2xl">
          Windows cashier apps paired to this branch. Each terminal holds a long-lived device
          token. Revoking a terminal immediately locks it on its next network check-in.
        </p>
      </div>

      <div className="flex-1 overflow-auto p-8">
        <div className="bg-[#161616] border border-[#2A2A2A] max-w-5xl">
          {isLoading ? (
            <p className="px-6 py-8 text-[#666] text-sm font-body">Loading…</p>
          ) : devices.length === 0 ? (
            <p className="px-6 py-8 text-[#666] text-sm font-body">
              No terminals paired yet. Install the desktop app on a cashier PC and run through
              first-run setup to register one.
            </p>
          ) : (
            <table className="w-full text-sm font-body">
              <thead className="bg-[#1A1A1A] text-[#666] text-[10px] tracking-widest uppercase">
                <tr>
                  <th className="px-6 py-3 text-left">Name</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Last seen</th>
                  <th className="px-4 py-3 text-left">Paired</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((d) => (
                  <tr key={d.id} className="border-t border-[#2A2A2A] hover:bg-[#1A1A1A]">
                    <td className="px-6 py-3 text-white">
                      {editingId === d.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            autoFocus
                            value={draftName}
                            onChange={(e) => setDraftName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditingId(null); }}
                            className="bg-[#0D0D0D] border border-[#2A2A2A] text-white px-2 py-1 text-xs font-body"
                          />
                          <button onClick={commitEdit} title="Save" className="p-1 text-[#4CAF50] hover:bg-[#2A2A2A]"><Check size={14} /></button>
                          <button onClick={() => setEditingId(null)} title="Cancel" className="p-1 text-[#888] hover:bg-[#2A2A2A]"><X size={14} /></button>
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-2">
                          <span>{d.name}</span>
                          <button onClick={() => startEdit(d)} title="Rename" className="p-1 text-[#555] hover:text-white">
                            <Pencil size={12} />
                          </button>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {!d.isActive ? (
                        <span className="text-[10px] font-medium tracking-widest uppercase px-2 py-0.5 bg-[#2A2A2A] text-[#888]">
                          Revoked
                        </span>
                      ) : isOnline(d) ? (
                        <span className="text-[10px] font-medium tracking-widest uppercase px-2 py-0.5 bg-[#4CAF50]/20 text-[#4CAF50]">
                          Online
                        </span>
                      ) : (
                        <span className="text-[10px] font-medium tracking-widest uppercase px-2 py-0.5 bg-[#2A2A2A] text-[#999]">
                          Offline
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[#CCC]">{formatRelative(d.lastSeenAt)}</td>
                    <td className="px-4 py-3 text-[#CCC]">{new Date(d.createdAt).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-right">
                      {d.isActive && (
                        <button
                          onClick={() => {
                            if (confirm(`Revoke "${d.name}"? The terminal will self-lock on its next network check-in.`)) {
                              revokeMut.mutate(d.id);
                            }
                          }}
                          title="Revoke"
                          className="inline-flex items-center gap-1 text-[#D62B2B] hover:bg-[#D62B2B]/10 px-2 py-1 text-[10px] font-medium tracking-widest uppercase"
                        >
                          <Power size={12} /> Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
