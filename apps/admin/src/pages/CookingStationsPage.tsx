import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, X } from 'lucide-react';

import { api } from '../lib/api';

interface CookingStation {
  id: string;
  name: string;
  printerName: string | null;
  printerIp: string | null;
  isActive: boolean;
}

function StationDialog({
  initial,
  onClose,
}: {
  initial?: CookingStation;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(initial?.name ?? '');
  const [printerName, setPrinterName] = useState(initial?.printerName ?? '');
  const [printerIp, setPrinterIp] = useState(initial?.printerIp ?? '');

  const mutation = useMutation({
    mutationFn: () => {
      const body = {
        name,
        printerName: printerName || undefined,
        printerIp: printerIp || undefined,
      };
      return initial
        ? api.patch(`/cooking-stations/${initial.id}`, body)
        : api.post('/cooking-stations', body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cooking-stations'] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-[#161616] w-[400px] p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-xl tracking-wide">
            {initial ? 'EDIT' : 'ADD'} COOKING STATION
          </h3>
          <button onClick={onClose} className="text-[#999] hover:text-white">
            <X size={16} />
          </button>
        </div>

        <div>
          <label className="text-xs font-body font-medium tracking-widest uppercase text-[#999] block mb-1">
            Name *
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Kitchen, Barista, Grill"
            className="w-full border border-[#2A2A2A] px-3 py-2.5 text-sm font-body outline-none focus:border-[#D62B2B] bg-[#0D0D0D] text-white"
            autoFocus
          />
        </div>

        <div>
          <label className="text-xs font-body font-medium tracking-widest uppercase text-[#999] block mb-1">
            Printer Name
          </label>
          <input
            type="text"
            value={printerName}
            onChange={(e) => setPrinterName(e.target.value)}
            placeholder="OS printer name"
            className="w-full border border-[#2A2A2A] px-3 py-2.5 text-sm font-body outline-none focus:border-[#D62B2B] bg-[#0D0D0D] text-white"
          />
        </div>

        <div>
          <label className="text-xs font-body font-medium tracking-widest uppercase text-[#999] block mb-1">
            Printer IP
          </label>
          <input
            type="text"
            value={printerIp}
            onChange={(e) => setPrinterIp(e.target.value)}
            placeholder="e.g. 192.168.1.100"
            className="w-full border border-[#2A2A2A] px-3 py-2.5 text-sm font-body outline-none focus:border-[#D62B2B] bg-[#0D0D0D] text-white"
          />
        </div>

        {mutation.isError && (
          <p className="text-xs text-[#D62B2B]">{(mutation.error as Error).message}</p>
        )}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 border border-[#2A2A2A] py-2.5 text-sm font-body text-[#999]"
          >
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!name.trim() || mutation.isPending}
            className="flex-1 bg-[#D62B2B] text-white py-2.5 text-sm font-body font-medium disabled:opacity-40"
          >
            {mutation.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CookingStationsPage() {
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<{ open: boolean; station?: CookingStation }>({
    open: false,
  });

  const { data: stations = [] } = useQuery<CookingStation[]>({
    queryKey: ['cooking-stations'],
    queryFn: () => api.get('/cooking-stations'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/cooking-stations/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['cooking-stations'] }),
  });

  const toggleMutation = useMutation({
    mutationFn: (station: CookingStation) =>
      api.patch(`/cooking-stations/${station.id}`, { isActive: !station.isActive }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['cooking-stations'] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <p className="text-[#D62B2B] text-xs font-body font-medium tracking-widest uppercase mb-1">
            Settings
          </p>
          <h1 className="font-display text-4xl text-white tracking-wide">COOKING STATIONS</h1>
        </div>
        <button
          onClick={() => setDialog({ open: true })}
          className="flex items-center gap-1.5 bg-[#D62B2B] text-white px-4 py-2 text-sm font-body font-medium hover:bg-[#F03535] transition-colors"
        >
          <Plus size={14} /> Add Station
        </button>
      </div>

      <div className="bg-[#161616] border border-[#2A2A2A]">
        <table className="w-full text-sm font-body">
          <thead>
            <tr className="text-left text-xs text-[#999] tracking-widest uppercase border-b border-[#2A2A2A]">
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-5 py-3 font-medium">Printer Name</th>
              <th className="px-5 py-3 font-medium">Printer IP</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium w-28">Actions</th>
            </tr>
          </thead>
          <tbody>
            {stations.map((station) => (
              <tr key={station.id} className="border-b border-[#2A2A2A] last:border-0">
                <td className="px-5 py-3 font-medium text-white">{station.name}</td>
                <td className="px-5 py-3 text-[#999]">{station.printerName ?? '--'}</td>
                <td className="px-5 py-3 text-[#999]">{station.printerIp ?? '--'}</td>
                <td className="px-5 py-3">
                  <button
                    onClick={() => toggleMutation.mutate(station)}
                    className={`text-xs font-medium ${station.isActive ? 'text-green-600' : 'text-[#999]'}`}
                  >
                    {station.isActive ? 'Active' : 'Inactive'}
                  </button>
                </td>
                <td className="px-5 py-3">
                  <div className="flex gap-2">
                    <button
                      onClick={() => setDialog({ open: true, station })}
                      className="text-[#999] hover:text-white"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Delete "${station.name}"?`)) deleteMutation.mutate(station.id);
                      }}
                      className="text-[#999] hover:text-[#D62B2B]"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {stations.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-[#999]">
                  No cooking stations configured
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {dialog.open && (
        <StationDialog
          initial={dialog.station}
          onClose={() => setDialog({ open: false })}
        />
      )}
    </div>
  );
}
