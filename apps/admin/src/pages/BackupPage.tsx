import { useState, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Database, Download, Trash2, Upload, RefreshCw, AlertTriangle, Clock } from 'lucide-react';

interface BackupRecord {
  id: string;
  filename: string;
  sizeBytes: number;
  type: 'MANUAL' | 'AUTO';
  createdAt: string;
}

interface BackupSchedule {
  id: string;
  frequency: 'OFF' | 'DAILY' | 'WEEKLY' | 'MONTHLY';
  timeHour: number;
  retention: number;
  lastRunAt: string | null;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

export default function BackupPage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: backups = [], isLoading } = useQuery<BackupRecord[]>({
    queryKey: ['backups'],
    queryFn: () => api.get('/backup'),
  });

  const { data: schedule } = useQuery<BackupSchedule>({
    queryKey: ['backup-schedule'],
    queryFn: () => api.get('/backup/schedule'),
  });

  const [freq, setFreq] = useState<string>('');
  const [hour, setHour] = useState<number | ''>('');
  const [retention, setRetention] = useState<number | ''>('');

  const scheduleFreq = freq || schedule?.frequency || 'OFF';
  const scheduleHour = hour !== '' ? hour : schedule?.timeHour ?? 2;
  const scheduleRetention = retention !== '' ? retention : schedule?.retention ?? 10;

  const createMut = useMutation({
    mutationFn: () => api.post<BackupRecord>('/backup', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['backups'] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/backup/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['backups'] }),
  });

  const saveScheduleMut = useMutation({
    mutationFn: () =>
      api.put('/backup/schedule', {
        frequency: scheduleFreq,
        timeHour: Number(scheduleHour),
        retention: Number(scheduleRetention),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['backup-schedule'] });
      setFreq(''); setHour(''); setRetention('');
    },
  });

  const [restoreTargetId, setRestoreTargetId] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [uploading, setUploading] = useState(false);

  const restoreMut = useMutation({
    mutationFn: () => api.post(`/backup/restore/${restoreTargetId}`, { password }),
    onSuccess: () => {
      alert('Restore complete. Data has been replaced from the backup.');
      setRestoreTargetId(null);
      setPassword('');
      qc.invalidateQueries();
    },
    onError: (e: Error) => alert(e.message || 'Restore failed'),
  });

  const handleDownload = async (id: string) => {
    try {
      const { blob, filename } = await api.downloadBlob(`/backup/${id}/download`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const handleUploadClick = () => fileRef.current?.click();

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setUploading(true);
    try {
      const record = await api.upload<BackupRecord>('/backup/upload', f);
      await qc.invalidateQueries({ queryKey: ['backups'] });
      // Open the restore confirm modal targeting the just-uploaded record.
      setRestoreTargetId(record.id);
    } catch (err) {
      alert(`Upload failed: ${(err as Error).message}`);
    } finally {
      setUploading(false);
    }
  };

  const restoreDialogOpen = restoreTargetId !== null;
  const restoreLabel = restoreTargetId
    ? backups.find((b) => b.id === restoreTargetId)?.filename
    : undefined;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-8 py-5 border-b border-[#2A2A2A] flex items-center justify-between">
        <div>
          <p className="text-[#D62B2B] text-xs font-body font-medium tracking-widest uppercase">Owner only</p>
          <h1 className="font-display text-white text-4xl tracking-wide flex items-center gap-3">
            <Database size={28} /> DATABASE BACKUPS
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleUploadClick}
            disabled={uploading}
            className="flex items-center gap-2 bg-[#1A1A1A] border border-[#2A2A2A] text-white px-4 py-2.5 text-xs font-body font-medium hover:bg-[#222] transition-colors tracking-widest uppercase disabled:opacity-40"
          >
            <Upload size={14} /> {uploading ? 'Uploading...' : 'Restore from file'}
          </button>
          <button
            onClick={() => createMut.mutate()}
            disabled={createMut.isPending}
            className="flex items-center gap-2 bg-[#D62B2B] text-white px-5 py-2.5 text-xs font-body font-medium hover:bg-[#F03535] transition-colors tracking-widest uppercase disabled:opacity-40"
          >
            <RefreshCw size={14} className={createMut.isPending ? 'animate-spin' : ''} />
            {createMut.isPending ? 'Backing up...' : 'Backup now'}
          </button>
        </div>
      </div>

      <input ref={fileRef} type="file" accept=".gz,.json" className="hidden" onChange={handleFilePick} />

      <div className="flex-1 overflow-auto p-8 space-y-6 max-w-5xl">
        {/* Schedule */}
        <div className="bg-[#161616] border border-[#2A2A2A] p-6">
          <h2 className="font-display text-white text-xl tracking-wider flex items-center gap-2 mb-4">
            <Clock size={18} /> AUTO-BACKUP SCHEDULE
          </h2>
          <div className="grid grid-cols-4 gap-4">
            <div>
              <label className="text-[#666] text-[10px] font-body font-medium tracking-widest uppercase mb-1 block">Frequency</label>
              <select
                value={scheduleFreq}
                onChange={(e) => setFreq(e.target.value)}
                className="w-full bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body"
              >
                <option value="OFF">Off (manual only)</option>
                <option value="DAILY">Daily</option>
                <option value="WEEKLY">Weekly</option>
                <option value="MONTHLY">Monthly</option>
              </select>
            </div>
            <div>
              <label className="text-[#666] text-[10px] font-body font-medium tracking-widest uppercase mb-1 block">Run at (hour)</label>
              <select
                value={scheduleHour}
                onChange={(e) => setHour(Number(e.target.value))}
                disabled={scheduleFreq === 'OFF'}
                className="w-full bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body disabled:opacity-40"
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[#666] text-[10px] font-body font-medium tracking-widest uppercase mb-1 block">Keep last N auto</label>
              <input
                type="number"
                min={1}
                max={365}
                value={scheduleRetention}
                onChange={(e) => setRetention(Number(e.target.value))}
                className="w-full bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={() => saveScheduleMut.mutate()}
                disabled={saveScheduleMut.isPending}
                className="w-full bg-[#D62B2B] text-white px-4 py-2 text-xs font-body font-medium hover:bg-[#F03535] transition-colors tracking-widest uppercase disabled:opacity-40"
              >
                {saveScheduleMut.isPending ? 'Saving...' : 'Save schedule'}
              </button>
            </div>
          </div>
          {schedule?.lastRunAt && (
            <p className="text-[#666] text-xs font-body mt-3">
              Last auto-backup: <span className="text-white">{formatDate(schedule.lastRunAt)}</span>
            </p>
          )}
        </div>

        {/* List */}
        <div className="bg-[#161616] border border-[#2A2A2A]">
          <div className="px-6 py-4 border-b border-[#2A2A2A] flex items-center justify-between">
            <h2 className="font-display text-white text-xl tracking-wider">BACKUP HISTORY</h2>
            <span className="text-[#666] text-xs font-body">{backups.length} backup{backups.length !== 1 ? 's' : ''}</span>
          </div>
          {isLoading ? (
            <p className="px-6 py-8 text-[#666] text-sm font-body">Loading...</p>
          ) : backups.length === 0 ? (
            <p className="px-6 py-8 text-[#666] text-sm font-body">No backups yet. Click "Backup now" to create one.</p>
          ) : (
            <table className="w-full text-sm font-body">
              <thead className="bg-[#1A1A1A] text-[#666] text-[10px] tracking-widest uppercase">
                <tr>
                  <th className="px-6 py-3 text-left">Filename</th>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-left">Size</th>
                  <th className="px-4 py-3 text-left">Created</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {backups.map((b) => (
                  <tr key={b.id} className="border-t border-[#2A2A2A] hover:bg-[#1A1A1A]">
                    <td className="px-6 py-3 text-white text-xs font-mono truncate max-w-xs">{b.filename}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-medium tracking-widest uppercase px-2 py-0.5 ${b.type === 'AUTO' ? 'bg-[#2A2A2A] text-[#999]' : 'bg-[#D62B2B]/20 text-[#D62B2B]'}`}>
                        {b.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#CCC]">{formatBytes(b.sizeBytes)}</td>
                    <td className="px-4 py-3 text-[#CCC]">{formatDate(b.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={() => handleDownload(b.id)}
                          title="Download"
                          className="p-1.5 text-[#CCC] hover:text-white hover:bg-[#2A2A2A] transition-colors"
                        >
                          <Download size={14} />
                        </button>
                        <button
                          onClick={() => setRestoreTargetId(b.id)}
                          title="Restore from this backup"
                          className="p-1.5 text-[#CCC] hover:text-[#D62B2B] hover:bg-[#2A2A2A] transition-colors"
                        >
                          <RefreshCw size={14} />
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Delete backup "${b.filename}"?`)) deleteMut.mutate(b.id);
                          }}
                          title="Delete"
                          className="p-1.5 text-[#CCC] hover:text-[#D62B2B] hover:bg-[#2A2A2A] transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Restore confirm modal */}
      {restoreDialogOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-[#161616] border border-[#2A2A2A] w-full max-w-md p-6">
            <h3 className="font-display text-white text-2xl tracking-wider flex items-center gap-2 mb-2">
              <AlertTriangle size={20} className="text-[#D62B2B]" /> RESTORE DATABASE
            </h3>
            <p className="text-[#CCC] text-xs font-body mb-2">
              This will <span className="text-[#D62B2B] font-semibold">wipe all current data</span> and replace it with the contents of:
            </p>
            <p className="text-white text-xs font-mono bg-[#0D0D0D] border border-[#2A2A2A] px-3 py-2 mb-4 break-all">
              {restoreLabel}
            </p>
            <p className="text-[#CCC] text-xs font-body mb-3">
              Type the owner password to confirm.
            </p>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Owner password"
              className="w-full bg-[#0D0D0D] border border-[#2A2A2A] text-white px-3 py-2 text-sm font-body mb-4"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setRestoreTargetId(null);
                  setPassword('');
                }}
                disabled={restoreMut.isPending}
                className="bg-[#1A1A1A] border border-[#2A2A2A] text-white px-4 py-2 text-xs font-body tracking-widest uppercase hover:bg-[#222] disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={() => restoreMut.mutate()}
                disabled={!password || restoreMut.isPending}
                className="bg-[#D62B2B] text-white px-4 py-2 text-xs font-body tracking-widest uppercase hover:bg-[#F03535] disabled:opacity-40"
              >
                {restoreMut.isPending ? 'Restoring...' : 'Confirm restore'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
