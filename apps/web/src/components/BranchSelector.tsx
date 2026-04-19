import { useQuery } from '@tanstack/react-query';
import { useState, useEffect } from 'react';

const BASE = ((import.meta as any).env?.VITE_API_BASE_URL as string | undefined) ?? '/api/v1';

interface Branch { id: string; name: string; address: string | null }

/** Returns the current branch ID — stored in localStorage, defaults to first branch */
export function useBranchId(): string {
  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ['public-branches'],
    queryFn: () => fetch(`${BASE}/public/branches`).then((r) => r.json()),
    staleTime: 300_000,
  });
  const [id, setId] = useState(() => localStorage.getItem('rp-branch') || '');

  useEffect(() => {
    if (!id && branches.length > 0) {
      setId(branches[0].id);
      localStorage.setItem('rp-branch', branches[0].id);
    }
  }, [branches, id]);

  return id || localStorage.getItem('rp-branch') || 'branch-main';
}

export default function BranchSelector() {
  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ['public-branches'],
    queryFn: () => fetch(`${BASE}/public/branches`).then((r) => r.json()),
    staleTime: 300_000,
  });

  const [selected, setSelected] = useState(() => localStorage.getItem('rp-branch') || '');

  useEffect(() => {
    if (!selected && branches.length > 0) {
      setSelected(branches[0].id);
      localStorage.setItem('rp-branch', branches[0].id);
    }
  }, [branches, selected]);

  // Hide if only 1 branch
  if (branches.length <= 1) return null;

  return (
    <select
      value={selected}
      onChange={(e) => {
        setSelected(e.target.value);
        localStorage.setItem('rp-branch', e.target.value);
        window.location.reload(); // reload to refetch all data with new branch
      }}
      className="bg-transparent border border-border text-text text-xs px-2 py-1 focus:outline-none focus:border-accent"
    >
      {branches.map((b) => (
        <option key={b.id} value={b.id} className="bg-card text-text">{b.name}</option>
      ))}
    </select>
  );
}
