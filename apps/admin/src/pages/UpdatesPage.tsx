import { useState, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UploadCloud, CheckCircle2, AlertTriangle, RotateCcw, Package } from 'lucide-react';
import { api } from '../lib/api';

/**
 * Settings → Updates. Admin uploads a release zip, reviews what
 * version it came out to, then clicks Apply — which triggers a
 * server-side DB backup, file swap, and API restart. The UI polls
 * /updater/history every 4s while a row is APPLYING so the status
 * flips to APPLIED without a manual refresh.
 *
 * Who can see this: OWNER role only. Server-side guard is the
 * authoritative check; the nav link is hidden for other roles as
 * a convenience.
 */

type Status = 'STAGED' | 'APPLYING' | 'APPLIED' | 'ROLLED_BACK' | 'FAILED';

interface UpdateRecord {
  id: string;
  toVersion: string;
  fromVersion: string;
  status: Status;
  zipSha256: string;
  notes: string | null;
  uploadedAt: string;
  appliedAt: string | null;
  rolledBackAt: string | null;
}

export default function UpdatesPage() {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const { data: history = [] } = useQuery<UpdateRecord[]>({
    queryKey: ['updater', 'history'],
    queryFn: () => api.get<UpdateRecord[]>('/updater/history'),
    // Poll every 4s while an APPLYING row exists — the exit + PM2
    // restart takes ~10s, we want the UI to catch the flip.
    refetchInterval: (query) => {
      const d = query.state.data as UpdateRecord[] | undefined;
      return d?.some((r) => r.status === 'APPLYING') ? 4_000 : 15_000;
    },
  });

  const uploadMutation = useMutation({
    mutationFn: (f: File) => api.upload<UpdateRecord>('/updater/upload', f, 'zip'),
    onSuccess: () => {
      setFile(null);
      setUploadError(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      void qc.invalidateQueries({ queryKey: ['updater'] });
    },
    onError: (err: Error) => {
      setUploadError(err.message);
    },
  });

  const applyMutation = useMutation({
    mutationFn: (id: string) => api.post(`/updater/apply/${id}`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['updater'] }),
  });

  const rollbackMutation = useMutation({
    mutationFn: (id: string) => api.post(`/updater/rollback/${id}`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['updater'] }),
  });

  const staged = history.find((r) => r.status === 'STAGED');
  const applying = history.find((r) => r.status === 'APPLYING');
  const latestApplied = history.find((r) => r.status === 'APPLIED');

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <Package className="w-6 h-6 text-[#D62B2B]" />
        <h1 className="text-2xl font-display text-white tracking-wider">UPDATES</h1>
      </div>

      {applying && (
        <div className="mb-6 p-5 border border-[#7a5a1e] bg-[#2e2514] flex items-start gap-4">
          <AlertTriangle className="w-6 h-6 text-[#fbbf24] shrink-0 mt-1" />
          <div>
            <div className="font-display text-[#fbbf24] tracking-wider mb-1">APPLYING — DO NOT CLOSE</div>
            <p className="text-sm text-[#ccc]">
              The server is applying update to version {applying.toVersion}. This page will refresh in ~10
              seconds when the new version boots.
            </p>
          </div>
        </div>
      )}

      {/* ── Upload card ─────────────────────────────────────────── */}
      <div className="bg-[#141414] border border-[#2A2A2A] p-5 mb-6">
        <h3 className="text-sm text-white font-display tracking-wider mb-3">UPLOAD NEW RELEASE</h3>
        {uploadError && (
          <div className="mb-4 p-3 bg-[#2a1416] border border-[#7a2128] text-sm text-[#f87171]">
            {uploadError}
          </div>
        )}
        <label className="block border-2 border-dashed border-[#333] p-8 text-center cursor-pointer hover:border-[#666] transition-colors">
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip"
            onChange={(e) => {
              setUploadError(null);
              setFile(e.target.files?.[0] ?? null);
            }}
            className="hidden"
            disabled={uploadMutation.isPending || !!applying}
          />
          <UploadCloud className="w-10 h-10 text-[#666] mx-auto mb-2" />
          <div className="text-sm text-[#ccc]">
            {file ? (
              <span className="font-mono">
                {file.name} ({(file.size / (1024 * 1024)).toFixed(1)} MB)
              </span>
            ) : (
              <>Click to pick a release zip, or drop one here.</>
            )}
          </div>
        </label>
        <button
          disabled={!file || uploadMutation.isPending || !!applying}
          onClick={() => file && uploadMutation.mutate(file)}
          className="mt-4 px-5 py-2.5 bg-[#D62B2B] text-white font-display tracking-wider text-sm hover:bg-[#B02020] disabled:opacity-50 disabled:cursor-not-allowed"
          type="button"
        >
          {uploadMutation.isPending ? 'VERIFYING…' : 'UPLOAD + VERIFY'}
        </button>
        <p className="text-xs text-[#666] mt-3 leading-relaxed">
          Upload verifies the release signature + file hashes against a public key bundled into this
          build. A failed verification does NOT apply anything; you'll see the reason inline so you
          know whether to download a fresh zip or contact support.
        </p>
      </div>

      {/* ── Ready to apply ──────────────────────────────────────── */}
      {staged && (
        <div className="bg-[#0f2a1f] border border-[#1c5b3c] p-5 mb-6">
          <div className="flex items-start gap-3 mb-3">
            <CheckCircle2 className="w-6 h-6 text-[#34d399] shrink-0 mt-1" />
            <div className="flex-1">
              <div className="font-display text-[#34d399] tracking-wider mb-1">STAGED — READY TO APPLY</div>
              <p className="text-sm text-[#ccc]">
                Version <span className="font-mono text-white">{staged.toVersion}</span> verified. Applying
                will: (1) create a database backup, (2) swap the current files for the new ones, (3)
                run database migrations, (4) restart the API. Expect ~15 seconds of downtime.
              </p>
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button
              onClick={() => {
                if (confirm(`Apply update to ${staged.toVersion}? The server will briefly restart.`)) {
                  applyMutation.mutate(staged.id);
                }
              }}
              disabled={applyMutation.isPending}
              className="px-5 py-2.5 bg-[#D62B2B] text-white font-display tracking-wider text-sm hover:bg-[#B02020] disabled:opacity-50"
              type="button"
            >
              {applyMutation.isPending ? 'APPLYING…' : 'APPLY NOW'}
            </button>
          </div>
        </div>
      )}

      {/* ── Current version + rollback ──────────────────────────── */}
      {latestApplied && !staged && !applying && (
        <div className="bg-[#141414] border border-[#2A2A2A] p-5 mb-6">
          <h3 className="text-sm text-white font-display tracking-wider mb-2">CURRENT VERSION</h3>
          <p className="text-sm text-[#ccc]">
            Running <span className="font-mono text-white">{latestApplied.toVersion}</span>, applied{' '}
            {new Date(latestApplied.appliedAt ?? latestApplied.uploadedAt).toLocaleString()}.
          </p>
          <button
            onClick={() => {
              if (confirm(`Roll back to ${latestApplied.fromVersion}? This restores the DB from the pre-apply backup.`)) {
                rollbackMutation.mutate(latestApplied.id);
              }
            }}
            disabled={rollbackMutation.isPending}
            className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-[#222] text-[#f87171] border border-[#333] text-xs hover:border-[#7a2128] disabled:opacity-50"
            type="button"
          >
            <RotateCcw size={13} /> Rollback to {latestApplied.fromVersion}
          </button>
        </div>
      )}

      {/* ── History ─────────────────────────────────────────────── */}
      <div className="bg-[#141414] border border-[#2A2A2A] p-5">
        <h3 className="text-sm text-white font-display tracking-wider mb-4">HISTORY</h3>
        {history.length === 0 ? (
          <p className="text-sm text-[#666]">No updates applied yet.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[#666] text-left">
                <th className="pb-2">At</th>
                <th className="pb-2">Version</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {history.map((r) => (
                <tr key={r.id} className="border-t border-[#222]">
                  <td className="py-2 text-[#999] font-mono">{new Date(r.uploadedAt).toLocaleString()}</td>
                  <td className="py-2 font-mono text-white">
                    {r.fromVersion} → {r.toVersion}
                  </td>
                  <td className="py-2">
                    <StatusPill s={r.status} />
                  </td>
                  <td className="py-2 text-[#999] max-w-sm truncate">{r.notes ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function StatusPill({ s }: { s: Status }) {
  const cfg: Record<Status, { bg: string; text: string; label: string }> = {
    STAGED: { bg: '#2e2514', text: '#fbbf24', label: 'STAGED' },
    APPLYING: { bg: '#2e2514', text: '#fbbf24', label: 'APPLYING' },
    APPLIED: { bg: '#0f2a1f', text: '#34d399', label: 'APPLIED' },
    ROLLED_BACK: { bg: '#1a1a1a', text: '#999', label: 'ROLLED BACK' },
    FAILED: { bg: '#2a1416', text: '#f87171', label: 'FAILED' },
  };
  const c = cfg[s];
  return (
    <span className="px-2 py-0.5 font-display tracking-wider text-[10px]" style={{ background: c.bg, color: c.text }}>
      {c.label}
    </span>
  );
}
