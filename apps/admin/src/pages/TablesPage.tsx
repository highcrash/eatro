import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, X } from 'lucide-react';

import type { DiningTable } from '@restora/types';
import { api } from '../lib/api';

const STATUS_COLOR: Record<string, string> = {
  AVAILABLE: 'bg-[#555]',
  OCCUPIED: 'bg-[#D62B2B]',
  RESERVED: 'bg-[#888]',
  CLEANING: 'bg-[#333]',
};

function AddTableDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [tableNumber, setTableNumber] = useState('');
  const [capacity, setCapacity] = useState('4');

  const mutation = useMutation({
    mutationFn: () => api.post('/tables', { tableNumber, capacity: parseInt(capacity, 10) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tables'] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-[#161616] w-[360px] p-6  space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-xl tracking-wide">ADD TABLE</h3>
          <button onClick={onClose} className="text-[#999] hover:text-white"><X size={16} /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-body font-medium tracking-widest uppercase text-[#999] block mb-1">Table Number *</label>
            <input value={tableNumber} onChange={(e) => setTableNumber(e.target.value)} placeholder="e.g. T7"
              className="w-full border border-[#2A2A2A] px-3 py-2.5 text-sm font-body outline-none focus:border-[#D62B2B] bg-[#0D0D0D] text-white" autoFocus />
          </div>
          <div>
            <label className="text-xs font-body font-medium tracking-widest uppercase text-[#999] block mb-1">Capacity</label>
            <input type="number" min="1" max="20" value={capacity} onChange={(e) => setCapacity(e.target.value)}
              className="w-full border border-[#2A2A2A] px-3 py-2.5 text-sm font-body outline-none focus:border-[#D62B2B] bg-[#0D0D0D] text-white" />
          </div>
        </div>
        {mutation.isError && <p className="text-xs text-[#D62B2B]">{(mutation.error as Error).message}</p>}
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 border border-[#2A2A2A] py-2.5 text-sm font-body text-[#999]">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={!tableNumber.trim() || mutation.isPending}
            className="flex-1 bg-[#D62B2B] text-white py-2.5 text-sm font-body font-medium disabled:opacity-40">
            {mutation.isPending ? 'Adding…' : 'Add Table'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TablesPage() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);

  const { data: tables = [] } = useQuery<DiningTable[]>({
    queryKey: ['tables'],
    queryFn: () => api.get<DiningTable[]>('/tables'),
  });

  const changeStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/tables/${id}/status`, { status }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['tables'] }),
  });

  const deleteTable = useMutation({
    mutationFn: (id: string) => api.delete(`/tables/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['tables'] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <p className="text-[#D62B2B] text-xs font-body font-medium tracking-widest uppercase mb-1">Management</p>
          <h1 className="font-display text-4xl text-white tracking-wide">TABLES</h1>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 bg-[#D62B2B] text-white px-4 py-2 text-sm font-body font-medium hover:bg-[#F03535] transition-colors">
          <Plus size={14} /> Add Table
        </button>
      </div>

      {/* Legend */}
      <div className="flex gap-5 mb-6 text-xs font-body">
        {Object.entries(STATUS_COLOR).map(([label, bg]) => (
          <div key={label} className="flex items-center gap-1.5">
            <span className={`w-2.5 h-2.5 ${bg}`} />
            <span className="text-[#999] capitalize">{label.toLowerCase()}</span>
          </div>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-5 gap-4">
        {tables.map((t) => (
          <div key={t.id} className="bg-[#161616] border border-[#2A2A2A] p-4 relative group">
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="font-display text-2xl text-white tracking-wide">{t.tableNumber}</p>
                <p className="text-xs font-body text-[#999]">{t.capacity} seats</p>
              </div>
              <span className={`w-3 h-3 shrink-0 mt-1 ${STATUS_COLOR[t.status] ?? ''}`} />
            </div>
            <div className="flex items-center justify-between mt-3">
              <select
                value={t.status}
                onChange={(e) => changeStatus.mutate({ id: t.id, status: e.target.value })}
                className="text-xs font-body text-[#999] border border-[#2A2A2A] px-2 py-1 bg-[#0D0D0D] text-white outline-none"
              >
                <option value="AVAILABLE">Available</option>
                <option value="OCCUPIED">Occupied</option>
                <option value="RESERVED">Reserved</option>
                <option value="CLEANING">Cleaning</option>
              </select>
              <button
                onClick={() => { if (confirm(`Delete table "${t.tableNumber}"?`)) deleteTable.mutate(t.id); }}
                className="text-[#555] hover:text-[#D62B2B] opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {showAdd && <AddTableDialog onClose={() => setShowAdd(false)} />}
    </div>
  );
}
