import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, X } from 'lucide-react';
import type {
  CashierPermissions,
  CustomRole,
  CreateCustomRoleDto,
  UpdateCustomRoleDto,
  UserRole,
} from '@restora/types';
import { api } from '../lib/api';

const BASE_ROLES: UserRole[] = ['OWNER', 'MANAGER', 'CASHIER', 'KITCHEN', 'WAITER', 'ADVISOR'];

// The subset of base roles that actually participate in the POS cashier-
// ops matrix. Custom roles for OWNER/MANAGER/KITCHEN don't need the POS
// tab (those roles bypass the matrix or aren't on the POS).
const POS_MATRIX_ROLES: UserRole[] = ['CASHIER', 'ADVISOR', 'WAITER'];

// Mirror of the POS cashier actions from permissions.ts. Kept in a local
// array rather than importing the constant so the admin page stays self-
// contained — if we add a new action, it shows up here with a friendly
// label once the server catches up.
const POS_ACTIONS: Array<{ key: keyof CashierPermissions; label: string }> = [
  { key: 'createPurchaseOrder', label: 'Create Purchase Order' },
  { key: 'receivePurchaseOrder', label: 'Receive Purchase Order' },
  { key: 'returnPurchaseOrder', label: 'Return Purchase Order' },
  { key: 'paySupplier', label: 'Pay Supplier' },
  { key: 'createExpense', label: 'Create Expense' },
  { key: 'payPayroll', label: 'Pay Payroll' },
  { key: 'createPreReadyKT', label: 'Pre-Ready Kitchen Ticket' },
];

const APPROVAL_MODES = ['NONE', 'AUTO', 'OTP'] as const;
type ApprovalMode = typeof APPROVAL_MODES[number];

export default function RolesPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<CustomRole | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const { data: roles = [] } = useQuery<CustomRole[]>({
    queryKey: ['custom-roles'],
    queryFn: () => api.get('/custom-roles'),
  });

  const deleteRole = useMutation({
    mutationFn: (id: string) => api.delete(`/custom-roles/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['custom-roles'] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[#D62B2B] text-xs font-body font-medium tracking-widest uppercase mb-1">Access</p>
          <h1 className="font-display text-4xl text-white tracking-wide">CUSTOM ROLES</h1>
          <p className="text-[11px] text-[#666] font-body mt-1">
            Presets that layer on top of a built-in base role. Can hide admin pages + tighten POS actions —
            <span className="text-[#888]"> never expand access beyond the base role.</span>
          </p>
        </div>
        <button onClick={() => { setEditing(null); setShowAdd(true); }}
          className="flex items-center gap-1.5 bg-[#D62B2B] text-white px-4 py-2 text-sm font-body font-medium hover:bg-[#F03535] transition-colors">
          <Plus size={14} /> New Role
        </button>
      </div>

      <div className="bg-[#161616] border border-[#2A2A2A] overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="text-left text-[10px] tracking-widest uppercase text-[#666] font-body bg-[#0D0D0D] border-b border-[#2A2A2A]">
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Base role</th>
              <th className="px-4 py-2">Description</th>
              <th className="px-4 py-2">Overrides</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {roles.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-[#666] font-body text-sm">No custom roles yet.</td></tr>
            ) : (
              roles.map((r) => {
                const navCount = r.adminNavOverrides ? Object.values(r.adminNavOverrides).filter((v) => v === false).length : 0;
                const posCount = r.posPermissions ? Object.keys(r.posPermissions).length : 0;
                return (
                  <tr key={r.id} className="border-b border-[#2A2A2A] hover:bg-[#1A1A1A]">
                    <td className="px-4 py-3 text-white font-medium text-sm">{r.name}</td>
                    <td className="px-4 py-3 text-[#FFA726] font-mono text-xs">{r.baseRole}</td>
                    <td className="px-4 py-3 text-[#999] text-xs">{r.description ?? '—'}</td>
                    <td className="px-4 py-3 text-[#999] text-xs">
                      {navCount > 0 && <span className="mr-2">{navCount} nav hidden</span>}
                      {posCount > 0 && <span>{posCount} POS override{posCount === 1 ? '' : 's'}</span>}
                      {!navCount && !posCount && <span className="text-[#555]">none</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => setEditing(r)} className="text-[#999] hover:text-white mr-2" title="Edit">
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => { if (confirm(`Delete role "${r.name}"? Assigned staff keep working on their base role.`)) deleteRole.mutate(r.id); }}
                        className="text-[#555] hover:text-[#D62B2B]"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {(showAdd || editing) && (
        <RoleDialog
          initial={editing}
          onClose={() => { setShowAdd(false); setEditing(null); }}
        />
      )}
    </div>
  );
}

function RoleDialog({ initial, onClose }: { initial: CustomRole | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [baseRole, setBaseRole] = useState<UserRole>(initial?.baseRole ?? 'CASHIER');
  const [navOverrides, setNavOverrides] = useState<Record<string, boolean>>(
    () => initial?.adminNavOverrides ?? {},
  );
  const [posPermissions, setPosPermissions] = useState<Partial<CashierPermissions>>(
    () => (initial?.posPermissions as Partial<CashierPermissions>) ?? {},
  );
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'nav' | 'pos'>('nav');

  // Pull the server's nav catalog — authoritative list of toggle-able paths
  // per base role. Keeps UI in sync with server-side validation.
  const { data: navCatalog = {} } = useQuery<Record<string, UserRole[]>>({
    queryKey: ['custom-role-nav-catalog'],
    queryFn: () => api.get('/custom-roles/nav-catalog'),
  });

  // Nav items the selected baseRole actually has access to. Anything outside
  // this list is silently skipped — admin can't toggle pages the base role
  // can't already reach.
  const eligibleNavPaths = useMemo(
    () => Object.entries(navCatalog)
      .filter(([, roles]) => roles.includes(baseRole))
      .map(([path]) => path)
      .sort(),
    [navCatalog, baseRole],
  );

  const showPosTab = POS_MATRIX_ROLES.includes(baseRole);

  const save = useMutation({
    mutationFn: () => {
      const payload: CreateCustomRoleDto | UpdateCustomRoleDto = {
        name: name.trim(),
        description: description.trim() || null,
        baseRole,
        adminNavOverrides: Object.keys(navOverrides).length > 0 ? navOverrides : null,
        posPermissions: Object.keys(posPermissions).length > 0 ? posPermissions : null,
      };
      if (initial) return api.patch(`/custom-roles/${initial.id}`, payload);
      return api.post('/custom-roles', payload);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['custom-roles'] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const toggleNav = (path: string) => {
    setNavOverrides((prev) => {
      const next = { ...prev };
      // If currently hidden (false) → un-hide (remove the key). If absent
      // → mark hidden (false). We never store `true` because that would
      // be a no-op (base role already shows it).
      if (next[path] === false) delete next[path];
      else next[path] = false;
      return next;
    });
  };

  const updatePos = (action: keyof CashierPermissions, patch: Partial<{ enabled: boolean; approval: ApprovalMode }>) => {
    setPosPermissions((prev) => {
      const existing = (prev[action] as { enabled?: boolean; approval?: ApprovalMode } | undefined) ?? { enabled: true, approval: 'AUTO' };
      const merged = { ...existing, ...patch };
      // If the override is now the "default" of enabled+AUTO, keep the key
      // so the admin sees their explicit choice. User can clear via the
      // "Use branch default" unset button below.
      return { ...prev, [action]: merged as unknown as CashierPermissions[typeof action] };
    });
  };

  const clearPos = (action: keyof CashierPermissions) => {
    setPosPermissions((prev) => {
      const next = { ...prev };
      delete next[action];
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="bg-[#0D0D0D] border border-[#2A2A2A] w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <header className="px-6 py-4 border-b border-[#2A2A2A] flex items-center justify-between">
          <h2 className="font-display text-2xl text-white tracking-wide">{initial ? 'EDIT ROLE' : 'NEW ROLE'}</h2>
          <button onClick={onClose} className="text-[#999] hover:text-white"><X size={18} /></button>
        </header>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] tracking-widest uppercase text-[#666] font-body block mb-1">Name *</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Head Chef"
                className="w-full border border-[#2A2A2A] px-3 py-2.5 text-sm font-body outline-none focus:border-[#D62B2B] bg-[#161616] text-white" />
            </div>
            <div>
              <label className="text-[10px] tracking-widest uppercase text-[#666] font-body block mb-1">Base role *</label>
              <select value={baseRole} onChange={(e) => setBaseRole(e.target.value as UserRole)}
                className="w-full border border-[#2A2A2A] px-3 py-2.5 text-sm font-body outline-none focus:border-[#D62B2B] bg-[#161616] text-white">
                {BASE_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-[10px] tracking-widest uppercase text-[#666] font-body block mb-1">Description</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Short note for the admin — e.g. 'Supervisor can approve supplier payments'"
              className="w-full border border-[#2A2A2A] px-3 py-2.5 text-sm font-body outline-none focus:border-[#D62B2B] bg-[#161616] text-white" />
          </div>

          <div className="flex items-stretch gap-0 border border-[#2A2A2A]">
            <button onClick={() => setTab('nav')}
              className={`flex-1 px-3 py-2 text-xs font-body tracking-widest uppercase transition-colors ${tab === 'nav' ? 'bg-[#D62B2B] text-white' : 'text-[#999] hover:text-white'}`}>
              Admin Navigation
            </button>
            <button onClick={() => setTab('pos')} disabled={!showPosTab}
              className={`flex-1 px-3 py-2 text-xs font-body tracking-widest uppercase transition-colors ${tab === 'pos' && showPosTab ? 'bg-[#D62B2B] text-white' : 'text-[#999] hover:text-white disabled:opacity-40 disabled:cursor-not-allowed'}`}>
              POS Actions
              {!showPosTab && <span className="block text-[8px] normal-case text-[#666] mt-0.5">base role isn't on the POS matrix</span>}
            </button>
          </div>

          {tab === 'nav' && (
            <div className="space-y-2">
              <p className="text-[11px] text-[#666] font-body">
                Uncheck any page to hide it from staff assigned this role. Showing only the {eligibleNavPaths.length} pages {baseRole} can already reach.
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 max-h-80 overflow-y-auto border border-[#2A2A2A] p-3">
                {eligibleNavPaths.map((path) => {
                  const hidden = navOverrides[path] === false;
                  return (
                    <label key={path} className="flex items-center gap-2 py-1 cursor-pointer hover:bg-[#161616] px-1">
                      <input type="checkbox" checked={!hidden} onChange={() => toggleNav(path)}
                        className="accent-[#D62B2B]" />
                      <span className={`text-xs font-mono ${hidden ? 'text-[#555] line-through' : 'text-[#DDD]'}`}>{path}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {tab === 'pos' && showPosTab && (
            <div className="space-y-2">
              <p className="text-[11px] text-[#666] font-body">
                Override the POS cashier-ops matrix for this role. Unconfigured rows fall back to the branch default.
              </p>
              <div className="border border-[#2A2A2A]">
                <table className="w-full">
                  <thead>
                    <tr className="text-left text-[9px] tracking-widest uppercase text-[#666] bg-[#161616] border-b border-[#2A2A2A]">
                      <th className="px-3 py-2">Action</th>
                      <th className="px-3 py-2">Enabled</th>
                      <th className="px-3 py-2">Approval</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {POS_ACTIONS.map((a) => {
                      const override = posPermissions[a.key] as { enabled?: boolean; approval?: ApprovalMode } | undefined;
                      const isOverridden = !!override;
                      return (
                        <tr key={a.key} className="border-b border-[#2A2A2A]">
                          <td className="px-3 py-2 text-xs text-white font-body">{a.label}</td>
                          <td className="px-3 py-2">
                            <input type="checkbox"
                              checked={override?.enabled ?? true}
                              onChange={(e) => updatePos(a.key, { enabled: e.target.checked })}
                              className="accent-[#D62B2B]" />
                          </td>
                          <td className="px-3 py-2">
                            <select
                              value={override?.approval ?? 'AUTO'}
                              onChange={(e) => updatePos(a.key, { approval: e.target.value as ApprovalMode })}
                              className="bg-[#161616] border border-[#2A2A2A] text-white text-xs font-body px-2 py-1 outline-none focus:border-[#D62B2B]">
                              {APPROVAL_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-2 text-right">
                            {isOverridden ? (
                              <button onClick={() => clearPos(a.key)}
                                className="text-[10px] text-[#888] hover:text-white tracking-widest uppercase">
                                Use branch default
                              </button>
                            ) : (
                              <span className="text-[10px] text-[#555]">branch default</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {error && <p className="text-xs text-[#D62B2B] font-body">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-[#2A2A2A] flex gap-3">
          <button onClick={onClose}
            className="flex-1 border border-[#2A2A2A] py-2.5 text-sm font-body text-[#999] hover:border-[#555] transition-colors">
            Cancel
          </button>
          <button onClick={() => { setError(''); if (!name.trim()) { setError('Name is required'); return; } save.mutate(); }}
            disabled={save.isPending}
            className="flex-1 bg-[#D62B2B] text-white py-2.5 text-sm font-body font-medium hover:bg-[#F03535] transition-colors disabled:opacity-40">
            {save.isPending ? 'Saving…' : initial ? 'Save Changes' : 'Create Role'}
          </button>
        </div>
      </div>
    </div>
  );
}
