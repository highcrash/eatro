import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { Plus, Minus, ArrowLeft, ShoppingBag, X, Printer, Search } from 'lucide-react';

import type { MenuItem, Order, OrderItem, CreateOrderDto, VoidOrderItemDto, WasteReason } from '@restora/types';
import { formatCurrency, printKitchenTicket as printKitchenTicketUtil } from '@restora/utils';
import { useBranchSettings } from '../hooks/useBranchSettings';
import { useBranding } from '../lib/branding';
import { isPlainCharKey } from '../lib/keyboard';
import { useIsOnline } from '../lib/online';
import { OfflineInlineHint } from '../components/OfflineHint';
import { useAuthStore } from '../store/auth.store';
import { api } from '../lib/api';
import PaymentModal from '../components/PaymentModal';
import ReceiptModal from '../components/ReceiptModal';
import BillModal from '../components/BillModal';
import RefundOrderDialog from '../components/RefundOrderDialog';
import CustomMenuDialog from '../components/CustomMenuDialog';
import VariantPickerDialog from '../components/VariantPickerDialog';
import CustomiseLineDialog from '../components/CustomiseLineDialog';
import AddonPickerDialog from '../components/AddonPickerDialog';
import { useCashierPermissions } from '../lib/permissions';

interface CartItem {
  menuItem: MenuItem;
  quantity: number;
  notes?: string;
  /** Ingredient IDs the customer asked to remove from this line.
   *  When set, the cart treats this as a distinct line from the same
   *  menu item without removals — so 2× without garlic + 2× normal
   *  land on two rows / two KT entries. */
  removedIngredientIds?: string[];
  /** Cached display names for the cart UI + the KT print fallback.
   *  Resolved when the cashier saves the dialog. */
  removedNames?: string[];
  /** Addon picks for this line; cart key includes a hash of the
   *  selected (groupId,addonItemId) pairs so different selections
   *  become separate cart rows. */
  addons?: { groupId: string; groupName: string; addonItemId: string; addonName: string; price: number }[];
}

/** Stable key for matching cart lines (variant + same removed-ID set
 *  + same addon picks + same notes = same cart row). */
function cartLineKey(item: { menuItem: { id: string }; removedIngredientIds?: string[]; notes?: string; addons?: { groupId: string; addonItemId: string }[] }): string {
  const ids = [...(item.removedIngredientIds ?? [])].sort().join(',');
  const addonsKey = [...(item.addons ?? [])]
    .map((a) => `${a.groupId}:${a.addonItemId}`)
    .sort()
    .join(',');
  return `${item.menuItem.id}::${ids}::${addonsKey}::${item.notes ?? ''}`;
}

// ─── Void Item Dialog ─────────────────────────────────────────────────────────

interface VoidItemDialogProps {
  item: OrderItem;
  orderId: string;
  isCashier: boolean;
  onClose: () => void;
  onConfirm: (dto: VoidOrderItemDto) => void;
  isPending: boolean;
  error?: string;
}

const VOID_WASTE_REASONS: { value: WasteReason; label: string }[] = [
  { value: 'SPOILAGE', label: 'Spoilage' },
  { value: 'PREPARATION_ERROR', label: 'Preparation Error' },
  { value: 'OVERCOOKED', label: 'Overcooked' },
  { value: 'CONTAMINATION', label: 'Contamination' },
  { value: 'OTHER', label: 'Other' },
];

function VoidItemDialog({ item, orderId, isCashier, onClose, onConfirm, isPending, error }: VoidItemDialogProps) {
  const [reason, setReason] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpManagerName, setOtpManagerName] = useState('');
  const [devOtp, setDevOtp] = useState(''); // Shown when SMS is disabled
  const [verifyError, setVerifyError] = useState('');
  const [sending, setSending] = useState(false);
  const [logAsWaste, setLogAsWaste] = useState(false);
  const [wasteReason, setWasteReason] = useState<WasteReason>('PREPARATION_ERROR');

  const requestOtp = async () => {
    if (!reason.trim()) return;
    setSending(true);
    setVerifyError('');
    try {
      const res = await api.post<{ sent: boolean; otp?: string; managerName?: string }>('/void-otp/request', {
        orderId,
        itemName: item.menuItemName,
        itemQty: item.quantity,
        reason,
      });
      setOtpSent(true);
      setOtpManagerName(res.managerName || 'Manager');
      if (res.otp) setDevOtp(res.otp); // SMS disabled — show OTP for dev
    } catch (e) {
      setVerifyError(e instanceof Error ? e.message : 'Failed to send OTP');
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = async () => {
    if (!reason.trim()) return;
    setVerifyError('');

    if (isCashier) {
      // Verify OTP
      try {
        const res = await api.post<{ valid: boolean; error?: string }>('/void-otp/verify', { orderId, otp });
        if (!res.valid) {
          setVerifyError(res.error || 'Invalid OTP');
          return;
        }
        // OTP verified — find a manager to use as approver
        const managers = await api.get<{ id: string; role: string }[]>('/staff');
        const mgr = (managers as any[]).find((s: any) => s.role === 'MANAGER' || s.role === 'OWNER');
        onConfirm({ reason, approverId: mgr?.id || 'otp-verified', logAsWaste, wasteReason: logAsWaste ? wasteReason : undefined });
      } catch (e) {
        setVerifyError(e instanceof Error ? e.message : 'Verification failed');
      }
    } else {
      const { user } = useAuthStore.getState();
      onConfirm({ reason, approverId: user!.id, logAsWaste, wasteReason: logAsWaste ? wasteReason : undefined });
    }
  };

  const canSubmit = reason.trim() !== '' && (!isCashier || (otpSent && otp.trim().length === 6));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-theme-surface rounded-theme shadow-2xl w-full max-w-[460px] max-h-[90vh] overflow-hidden flex flex-col">
        <header className="px-6 py-4 border-b border-theme-border flex items-center justify-between shrink-0">
          <div>
            <h3 className="text-lg font-bold text-theme-text">Void Item</h3>
            <p className="text-xs text-theme-text-muted mt-0.5">
              {item.quantity} × {item.menuItemName} · {formatCurrency(Number(item.totalPrice))}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-theme hover:bg-theme-bg flex items-center justify-center text-theme-text-muted"
          >
            <X size={14} />
          </button>
        </header>

        <div className="p-6 space-y-4 overflow-auto">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-theme-text-muted mb-1.5">
              Reason for void
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Customer changed order"
              className="w-full bg-theme-bg rounded-theme px-4 py-3 text-sm text-theme-text outline-none border border-transparent focus:border-theme-accent"
              autoFocus
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={logAsWaste}
              onChange={(e) => setLogAsWaste(e.target.checked)}
              className="w-4 h-4 accent-theme-accent"
            />
            <span className="text-sm text-theme-text">Log as waste (item was already prepared)</span>
          </label>

          {logAsWaste && (
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-theme-text-muted mb-1.5">
                Waste reason
              </label>
              <select
                value={wasteReason}
                onChange={(e) => setWasteReason(e.target.value as WasteReason)}
                className="w-full bg-theme-bg rounded-theme px-4 py-3 text-sm text-theme-text outline-none border border-transparent focus:border-theme-accent"
              >
                {VOID_WASTE_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
          )}

          {isCashier && (
            <div className="border-2 border-theme-accent/30 rounded-theme p-4 bg-theme-accent/5">
              <p className="text-xs font-bold uppercase tracking-wider text-theme-accent mb-2">Manager OTP Approval</p>
              {!otpSent ? (
                <button
                  onClick={() => void requestOtp()}
                  disabled={!reason.trim() || sending}
                  className="w-full bg-theme-text text-white py-2.5 rounded-theme text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-40"
                >
                  {sending ? 'Sending OTP…' : 'Send OTP to Manager'}
                </button>
              ) : (
                <>
                  <p className="text-[11px] text-theme-text-muted mb-3">
                    OTP sent to <span className="font-bold text-theme-text">{otpManagerName}</span>
                    {devOtp && <span className="text-theme-danger ml-2">(Dev: {devOtp})</span>}
                  </p>
                  <label className="block text-xs font-bold uppercase tracking-wider text-theme-text-muted mb-1.5">
                    Enter 6-digit OTP
                  </label>
                  <input
                    type="text"
                    maxLength={6}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                    placeholder="000000"
                    className="w-full bg-theme-surface border border-theme-border rounded-theme px-4 py-3 text-2xl font-bold font-mono tracking-[0.5em] text-center text-theme-text outline-none focus:border-theme-accent"
                    autoFocus
                  />
                  <button
                    onClick={() => { setOtpSent(false); setOtp(''); setDevOtp(''); }}
                    className="text-xs text-theme-text-muted hover:text-theme-accent mt-2"
                  >
                    Resend OTP
                  </button>
                </>
              )}
              {verifyError && (
                <p className="text-xs text-theme-danger mt-2">{verifyError}</p>
              )}
            </div>
          )}

          {error && <p className="text-xs text-theme-danger">{error}</p>}
        </div>

        <footer className="px-6 py-4 border-t border-theme-border flex gap-3 shrink-0">
          <button
            onClick={onClose}
            className="flex-1 bg-theme-bg text-theme-text font-semibold py-3 rounded-theme hover:bg-theme-surface-alt transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={!canSubmit || isPending || sending}
            className="flex-1 bg-theme-danger text-white font-bold py-3 rounded-theme hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            {sending || isPending ? 'Processing…' : 'Void Item'}
          </button>
        </footer>
      </div>
    </div>
  );
}

// ─── Add Items Overlay (with category + search) ─────────────────────────────

function AddItemsOverlay({
  menuItems,
  newItemCart,
  setNewItemCart,
  onClose,
  onSubmit,
  isPending,
  orderNumber,
}: {
  menuItems: MenuItem[];
  newItemCart: CartItem[];
  setNewItemCart: React.Dispatch<React.SetStateAction<CartItem[]>>;
  onClose: () => void;
  onSubmit: () => void;
  isPending: boolean;
  orderNumber: string;
}) {
  const [addSearch, setAddSearch] = useState('');
  const [addCatId, setAddCatId] = useState<string | null>(null);
  const [hoverIdx, setHoverIdx] = useState(0);
  const [showCustomMenu, setShowCustomMenu] = useState(false);
  const [variantPickerFor, setVariantPickerFor] = useState<MenuItem | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const { data: cashierPerms } = useCashierPermissions();
  const customMenuPerm = cashierPerms?.createCustomMenu;
  const canCreateCustom = !!customMenuPerm?.enabled && customMenuPerm.approval !== 'NONE';

  const variantsByParent = (() => {
    const m = new Map<string, MenuItem[]>();
    for (const item of menuItems) {
      if (item.variantParentId) {
        const arr = m.get(item.variantParentId) ?? [];
        arr.push(item);
        m.set(item.variantParentId, arr);
      }
    }
    return m;
  })();

  // Fetch categories from API for proper hierarchy (includes parents with 0 direct items)
  const { data: apiCategories = [] } = useQuery<{ id: string; name: string; parentId: string | null; children?: { id: string; name: string }[] }[]>({
    queryKey: ['menu-categories'],
    queryFn: () => api.get('/menu/categories'),
  });

  const parentCats = apiCategories
    .filter((c) => !c.parentId)
    .sort((a, b) => a.name.localeCompare(b.name));
  const getChildren = (pid: string) => apiCategories
    .filter((c) => c.parentId === pid)
    .sort((a, b) => a.name.localeCompare(b.name));

  // Filter items — same logic as the new-order grid: hide variant
  // children + custom one-offs.
  const searchLower = addSearch.trim().toLowerCase();
  const childIdsOfSelected = addCatId ? getChildren(addCatId).map((c) => c.id) : [];
  const filteredItems = menuItems
    .filter((m) => m.isAvailable)
    .filter((m) => !m.variantParentId && !m.isCustom && !m.isAddon)
    .filter((m) => {
      if (searchLower) return m.name.toLowerCase().includes(searchLower);
      if (!addCatId) return true;
      // Direct match on selected category, OR item is in a child of the selected parent
      return m.categoryId === addCatId || childIdsOfSelected.includes(m.categoryId);
    });

  const addToNewCart = (item: MenuItem) => {
    if (item.isVariantParent) {
      setVariantPickerFor(item);
      return;
    }
    const groups = (item.addonGroups ?? []).filter((g) => g.options.length > 0);
    if (groups.length > 0) {
      setAddonPickerForNew(item);
      return;
    }
    setNewItemCart((prev) => {
      const key = cartLineKey({ menuItem: { id: item.id } });
      const existing = prev.find((c) => cartLineKey(c) === key);
      if (existing) return prev.map((c) => cartLineKey(c) === key ? { ...c, quantity: c.quantity + 1 } : c);
      return [...prev, { menuItem: item, quantity: 1 }];
    });
  };

  const [customizingNewKey, setCustomizingNewKey] = useState<string | null>(null);
  const [addonPickerForNew, setAddonPickerForNew] = useState<MenuItem | null>(null);

  // ── Keyboard navigation ──────────────────────────────────────────────────
  const GRID_COLS = 5;
  const clampIdx = (i: number) => Math.max(0, Math.min(filteredItems.length - 1, i));

  // Reset the highlight whenever the result set changes.
  useEffect(() => {
    setHoverIdx(0);
  }, [addSearch, addCatId, filteredItems.length]);

  // Auto-focus the search box the moment the overlay opens so the cashier
  // can just start typing.
  useEffect(() => {
    const id = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';

      // Escape — if search has text, clear it; else let the outer onClose take over.
      if (e.key === 'Escape') {
        if (addSearch) { setAddSearch(''); e.preventDefault(); }
        return;
      }

      // Typing a plain character while focus is on a button / the grid: refocus
      // the search input AND append the character manually (focus alone wouldn't
      // deliver the keystroke because the event fires against the old target).
      if (!typing && isPlainCharKey(e)) {
        e.preventDefault();
        setAddSearch((prev) => prev + e.key);
        if (addCatId) setAddCatId(null);
        searchRef.current?.focus();
        return;
      }

      // Backspace while focused outside the search still edits the search (UX nicety).
      if (!typing && e.key === 'Backspace' && addSearch) {
        e.preventDefault();
        setAddSearch((prev) => prev.slice(0, -1));
        searchRef.current?.focus();
        return;
      }

      if (filteredItems.length === 0) return;

      if (e.key === 'ArrowRight') { setHoverIdx((i) => clampIdx(i + 1)); e.preventDefault(); return; }
      if (e.key === 'ArrowLeft')  { setHoverIdx((i) => clampIdx(i - 1)); e.preventDefault(); return; }
      if (e.key === 'ArrowDown')  { setHoverIdx((i) => clampIdx(i + GRID_COLS)); e.preventDefault(); return; }
      if (e.key === 'ArrowUp')    { setHoverIdx((i) => clampIdx(i - GRID_COLS)); e.preventDefault(); return; }
      if (e.key === 'Enter')      {
        const item = filteredItems[hoverIdx];
        if (item) { addToNewCart(item); e.preventDefault(); }
        return;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredItems, hoverIdx, addSearch, addCatId]);

  // Scroll the highlighted tile into view as the user arrows around.
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const child = grid.children[hoverIdx] as HTMLElement | undefined;
    if (child) child.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [hoverIdx]);

  const removeFromNewCart = (key: string) => {
    setNewItemCart((prev) => {
      const existing = prev.find((c) => cartLineKey(c) === key);
      if (!existing || existing.quantity <= 1) return prev.filter((c) => cartLineKey(c) !== key);
      return prev.map((c) => cartLineKey(c) === key ? { ...c, quantity: c.quantity - 1 } : c);
    });
  };

  const newCartTotal = newItemCart.reduce(
    (s, c) => {
      const addonsTotal = (c.addons ?? []).reduce((a, b) => a + b.price, 0);
      return s + (Number(c.menuItem.price) + addonsTotal) * c.quantity;
    },
    0,
  );

  return (
    <div className="fixed inset-0 z-40 bg-theme-bg flex flex-col">
      {/* Orange top bar */}
      <header className="h-16 bg-theme-accent text-white flex items-center px-6 gap-4 shrink-0">
        <button
          onClick={onClose}
          className="text-white text-sm font-semibold flex items-center gap-1 hover:opacity-80 transition-opacity"
        >
          <ArrowLeft size={16} /> Back to Order #{orderNumber}
        </button>
        <div className="h-8 w-px bg-white/30" />
        <h1 className="text-xl font-extrabold">Add Items</h1>
        <div className="flex-1" />
        <button onClick={onClose} className="text-white hover:opacity-80 transition-opacity">
          <X size={20} />
        </button>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Menu side */}
        <section className="flex-1 min-w-0 flex flex-col">
          {/* Search */}
          <div className="px-6 pt-4 pb-3 flex items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-theme-text-muted pointer-events-none" />
              <input
                ref={searchRef}
                type="text"
                value={addSearch}
                onChange={(e) => { setAddSearch(e.target.value); if (e.target.value) setAddCatId(null); }}
                placeholder="Search products… (start typing anywhere)"
                className="w-full bg-theme-surface rounded-full pl-11 pr-10 py-2.5 text-sm text-theme-text outline-none border border-theme-border focus:border-theme-accent"
              />
              {addSearch && (
                <button onClick={() => setAddSearch('')} className="absolute right-4 top-1/2 -translate-y-1/2 text-theme-text-muted hover:text-theme-text">
                  <X size={12} />
                </button>
              )}
            </div>
            {canCreateCustom && (
              <button
                type="button"
                onClick={() => setShowCustomMenu(true)}
                className="text-xs font-bold uppercase tracking-wider bg-theme-accent text-white rounded-theme px-3 py-2 hover:opacity-90 inline-flex items-center gap-1"
                title="Create a one-off custom menu item"
              >
                <Plus size={12} /> Custom
              </button>
            )}
          </div>

          {/* Category pill tabs */}
          {!searchLower && (
            <div className="px-6 pb-3">
              <div className="flex gap-1 bg-theme-surface rounded-theme p-1 border border-theme-border w-fit max-w-full overflow-x-auto">
                <button
                  onClick={() => setAddCatId(null)}
                  className={`px-4 py-2 text-sm rounded-theme whitespace-nowrap transition-colors ${
                    !addCatId ? 'font-semibold text-theme-accent border-2 border-theme-accent' : 'font-medium text-theme-text-muted hover:text-theme-text'
                  }`}
                >
                  All
                </button>
                {parentCats.map((cat) => {
                  const children = getChildren(cat.id);
                  const isParentActive = addCatId === cat.id;
                  const isChildActive = children.some((c) => c.id === addCatId);
                  return (
                    <button
                      key={cat.id}
                      onClick={() => setAddCatId(cat.id)}
                      className={`px-4 py-2 text-sm rounded-theme whitespace-nowrap transition-colors ${
                        isParentActive || isChildActive
                          ? 'font-semibold text-theme-accent border-2 border-theme-accent'
                          : 'font-medium text-theme-text-muted hover:text-theme-text'
                      }`}
                    >
                      {cat.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Menu grid (matches NewOrderView) */}
          <div
            ref={gridRef}
            className="flex-1 overflow-auto px-6 pb-6 grid grid-cols-5 gap-3 content-start"
          >
            {filteredItems.map((item, idx) => {
              const inCart = newItemCart.find((c) => c.menuItem.id === item.id);
              const isHover = idx === hoverIdx;
              const childCount = item.isVariantParent ? (variantsByParent.get(item.id)?.length ?? 0) : 0;
              return (
                <button
                  key={item.id}
                  onClick={() => { setHoverIdx(idx); addToNewCart(item); }}
                  className={`relative bg-theme-surface rounded-theme p-1.5 text-center border transition-all hover:border-theme-accent ${
                    inCart ? 'border-theme-pop border-2' : 'border-theme-border'
                  } ${isHover ? 'ring-2 ring-theme-accent ring-offset-1 ring-offset-theme-bg' : ''}`}
                >
                  {inCart && (
                    <div className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-theme-pop text-white flex items-center justify-center text-[9px] font-bold z-10">
                      {inCart.quantity}
                    </div>
                  )}
                  {item.isVariantParent && (
                    <div className="absolute top-0.5 left-0.5 px-1 py-0.5 text-[7px] font-bold uppercase tracking-wider text-white bg-theme-accent rounded-theme z-10">
                      {childCount}v
                    </div>
                  )}
                  <div className="aspect-square bg-theme-bg rounded-theme mb-1 flex items-center justify-center overflow-hidden">
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-base">🍽️</span>
                    )}
                  </div>
                  <p className="text-[10px] font-semibold text-theme-text leading-tight truncate">{item.name}</p>
                  <p className="text-[11px] font-bold text-theme-text">
                    {item.isVariantParent ? <span className="text-theme-text-muted text-[9px]">Pick variant</span> : formatCurrency(Number(item.price))}
                  </p>
                </button>
              );
            })}
            {filteredItems.length === 0 && (
              <p className="col-span-5 text-center py-12 text-theme-text-muted text-sm">No items found</p>
            )}
          </div>
        </section>

        {/* New items cart sidebar */}
        <aside className="w-[400px] shrink-0 bg-theme-surface border-l border-theme-border flex flex-col">
          <div className="px-5 py-4 border-b border-theme-border">
            <p className="text-xs font-bold uppercase tracking-wider text-theme-text-muted">New Items</p>
            <p className="text-xs text-theme-text-muted mt-0.5">These will be added to the existing order</p>
          </div>

          <div className="flex-1 overflow-auto p-4 space-y-2">
            {newItemCart.length === 0 ? (
              <p className="text-center text-theme-text-muted text-xs py-6">Tap items to add</p>
            ) : (
              newItemCart.map((line, idx) => {
                const { menuItem, quantity, notes, removedNames, addons } = line;
                const key = cartLineKey(line);
                const addonsTotal = (addons ?? []).reduce((s, a) => s + a.price, 0);
                const unitPrice = Number(menuItem.price) + addonsTotal;
                // React key uses the array index, NOT cartLineKey,
                // because cartLineKey embeds `notes`. Without this,
                // every keystroke in the note input rebuilt the
                // row's React key → React unmounted the input →
                // focus dumped to <body> → next keystroke got
                // hijacked into the menu searchbar by the global
                // keydown handler. Index is stable while editing
                // notes (cart isn't reordered mid-keystroke). The
                // inner `key` variable still carries cartLineKey
                // for state-mutation lookups (setNewItemCart).
                return (
                <div key={idx} className="bg-theme-bg rounded-theme p-3">
                  <div className="flex items-start gap-2">
                    <span className="w-7 h-7 rounded-full bg-theme-surface border border-theme-border flex items-center justify-center text-xs font-bold shrink-0">
                      {quantity}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-theme-text truncate">{menuItem.name}</p>
                      <p className="text-[11px] text-theme-text-muted">
                        {formatCurrency(unitPrice)} each
                      </p>
                      {addons && addons.length > 0 && (
                        <p className="text-[10px] text-theme-accent font-bold mt-0.5 leading-tight">
                          {addons.map((a) => `+ ${a.addonName}${a.price > 0 ? ` (${formatCurrency(a.price)})` : ''}`).join(' • ')}
                        </p>
                      )}
                      {removedNames && removedNames.length > 0 && (
                        <p className="text-[10px] text-theme-danger font-bold mt-0.5 leading-tight">
                          {removedNames.map((n) => `NO ${n.toUpperCase()}`).join(' • ')}
                        </p>
                      )}
                    </div>
                    <span className="text-sm font-bold text-theme-text shrink-0">
                      {formatCurrency(unitPrice * quantity)}
                    </span>
                  </div>

                  {notes !== undefined ? (
                    <div className="mt-2 flex items-center gap-1.5">
                      <input
                        autoFocus={!notes}
                        value={notes}
                        onChange={(e) => setNewItemCart((prev) => prev.map((c) => cartLineKey(c) === key ? { ...c, notes: e.target.value } : c))}
                        placeholder="e.g. extra spicy, well done"
                        className="flex-1 bg-theme-surface rounded-theme px-2 py-1 text-[11px] text-theme-text outline-none border border-theme-border focus:border-theme-accent"
                      />
                      <button
                        onClick={() => setNewItemCart((prev) => prev.map((c) => cartLineKey(c) === key ? { ...c, notes: undefined } : c))}
                        className="text-theme-text-muted hover:text-theme-danger text-xs"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  ) : null}

                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {notes === undefined && (
                        <button
                          onClick={() => setNewItemCart((prev) => prev.map((c) => cartLineKey(c) === key ? { ...c, notes: '' } : c))}
                          className="text-[10px] text-theme-text-muted hover:text-theme-accent flex items-center gap-1 transition-colors"
                        >
                          📝 Note
                        </button>
                      )}
                      <button
                        onClick={() => setCustomizingNewKey(key)}
                        className="text-[10px] text-theme-text-muted hover:text-theme-accent flex items-center gap-1 transition-colors"
                        title="Remove ingredients (no garlic, no peanut, etc.)"
                      >
                        🍴 Customise
                      </button>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => removeFromNewCart(key)}
                        className="w-6 h-6 rounded-full bg-theme-surface border border-theme-border flex items-center justify-center hover:border-theme-danger hover:text-theme-danger transition-colors"
                      >
                        <Minus size={10} />
                      </button>
                      <span className="w-4 text-center text-xs font-bold">{quantity}</span>
                      <button
                        onClick={() => setNewItemCart((prev) => prev.map((c) => cartLineKey(c) === key ? { ...c, quantity: c.quantity + 1 } : c))}
                        className="w-6 h-6 rounded-full bg-theme-surface border border-theme-border flex items-center justify-center hover:border-theme-accent hover:text-theme-accent transition-colors"
                      >
                        <Plus size={10} />
                      </button>
                    </div>
                  </div>
                </div>
                );
              })
            )}
          </div>

          <div className="p-4 border-t border-theme-border">
            <button
              onClick={onSubmit}
              disabled={newItemCart.length === 0 || isPending}
              className="w-full bg-theme-pop hover:opacity-90 text-white py-4 rounded-theme font-bold text-sm transition-opacity disabled:opacity-40"
            >
              {isPending ? 'Adding…' : `Add to Order (${formatCurrency(newCartTotal)})`}
            </button>
          </div>
        </aside>
      </div>

      {showCustomMenu && customMenuPerm && (
        <CustomMenuDialog
          approval={customMenuPerm.approval === 'OTP' ? 'OTP' : 'AUTO'}
          onClose={() => setShowCustomMenu(false)}
          onCreated={(item) => {
            setNewItemCart((prev) => [...prev, { menuItem: item, quantity: 1 }]);
            setShowCustomMenu(false);
          }}
        />
      )}

      {variantPickerFor && (
        <VariantPickerDialog
          parent={variantPickerFor}
          variants={variantsByParent.get(variantPickerFor.id) ?? []}
          onClose={() => setVariantPickerFor(null)}
          onPick={(variant) => {
            setVariantPickerFor(null);
            const groups = (variant.addonGroups ?? []).filter((g) => g.options.length > 0);
            if (groups.length > 0) {
              setAddonPickerForNew(variant);
              return;
            }
            setNewItemCart((prev) => {
              const key = cartLineKey({ menuItem: { id: variant.id } });
              const existing = prev.find((c) => cartLineKey(c) === key);
              if (existing) return prev.map((c) => cartLineKey(c) === key ? { ...c, quantity: c.quantity + 1 } : c);
              return [...prev, { menuItem: variant, quantity: 1 }];
            });
          }}
        />
      )}

      {addonPickerForNew && (
        <AddonPickerDialog
          menuItem={addonPickerForNew}
          groups={(addonPickerForNew.addonGroups ?? []).filter((g) => g.options.length > 0)}
          onClose={() => setAddonPickerForNew(null)}
          onSave={(picks) => {
            const item = addonPickerForNew;
            setAddonPickerForNew(null);
            setNewItemCart((prev) => {
              const newLine = { menuItem: item, quantity: 1, addons: picks };
              const key = cartLineKey({ menuItem: { id: item.id }, addons: picks });
              const existing = prev.find((c) => cartLineKey(c) === key);
              if (existing) return prev.map((c) => cartLineKey(c) === key ? { ...c, quantity: c.quantity + 1 } : c);
              return [...prev, newLine];
            });
          }}
        />
      )}

      {customizingNewKey && (() => {
        const line = newItemCart.find((c) => cartLineKey(c) === customizingNewKey);
        if (!line) return null;
        return (
          <CustomiseLineDialog
            menuItemId={line.menuItem.id}
            menuItemName={line.menuItem.name}
            initialRemovedIds={line.removedIngredientIds ?? []}
            onClose={() => setCustomizingNewKey(null)}
            onSave={(ids, names) => {
              setNewItemCart((prev) => {
                const updated = prev.map((c) => cartLineKey(c) === customizingNewKey ? { ...c, removedIngredientIds: ids.length > 0 ? ids : undefined, removedNames: names.length > 0 ? names : undefined } : c);
                const merged: typeof updated = [];
                for (const row of updated) {
                  const k = cartLineKey(row);
                  const existing = merged.find((m) => cartLineKey(m) === k);
                  if (existing) existing.quantity += row.quantity;
                  else merged.push(row);
                }
                return merged;
              });
              setCustomizingNewKey(null);
            }}
          />
        );
      })()}
    </div>
  );
}

// ─── Active Order View ────────────────────────────────────────────────────────

function ActiveOrderView({
  order: initialOrder,
  onBack,
}: {
  order: Order;
  onBack: () => void;
}) {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: branchSettings } = useBranchSettings();
  const { data: branding } = useBranding();
  const online = useIsOnline();
  const isCashier = user?.role === 'CASHIER' || user?.role === 'KITCHEN' || user?.role === 'WAITER';

  const [order, setOrder] = useState<Order>(initialOrder);

  // Sync with parent when server data updates (e.g. QR customer adds items)
  useEffect(() => {
    setOrder(initialOrder);
  }, [initialOrder]);

  const [showPayment, setShowPayment] = useState(false);
  const [showBill, setShowBill] = useState(false);
  const [showRefund, setShowRefund] = useState(false);
  const [paidOrder, setPaidOrder] = useState<Order | null>(null);
  const [cashReceived, setCashReceived] = useState(0);
  const [voidingItem, setVoidingItem] = useState<OrderItem | null>(null);
  const [showAddItems, setShowAddItems] = useState(false);
  const [newItemCart, setNewItemCart] = useState<CartItem[]>([]);

  const { data: orderWaiters = [] } = useQuery<{ id: string; name: string; role: string; isActive: boolean }[]>({
    queryKey: ['waiters'],
    queryFn: () => api.get('/staff'),
    select: (d: any[]) => d.filter((s) => s.isActive && s.role !== 'KITCHEN'),
  });

  const setWaiterMut = useMutation({
    mutationFn: (waiterId: string) => api.patch<Order>(`/orders/${order.id}/waiter`, { waiterId }),
    onSuccess: (updated) => {
      setOrder(updated);
      void queryClient.invalidateQueries({ queryKey: ['orders', 'table', order.tableId] });
    },
  });

  /**
   * Print the kitchen ticket via the right transport for this device.
   * Used by both the normal POS create-order flow AND the QR-accept
   * flow (QR orders sit at PENDING until the cashier accepts; that
   * acceptance is the moment the kitchen first sees the ticket).
   * Defined as a function declaration so it's reachable from the
   * mutations declared just below — `const` arrow form would TDZ.
   */
  async function maybePrintKitchenTicket(order: Order) {
    // Only auto-print when KDS is disabled — otherwise the KDS screen handles it.
    if (branchSettings && branchSettings.useKds) return;
    // Desktop path — await the IPC so a printer failure actually surfaces
    // instead of being swallowed into a fire-and-forget promise.
    const desktopPrint = (window as unknown as { desktop?: { print?: { kitchen?: (t: unknown) => Promise<{ ok: boolean; message?: string }> } } }).desktop?.print?.kitchen;
    if (desktopPrint) {
      try {
        const res = await desktopPrint(order);
        if (!res?.ok) {
          alert(`Kitchen print failed: ${res?.message ?? 'unknown error'}`);
        }
      } catch (err) {
        alert(`Kitchen print failed: ${(err as Error).message}`);
      }
      return;
    }
    // Browser fallback — popup window + auto-print.
    const ok = printKitchenTicketUtil(order as any);
    if (!ok) {
      alert('Kitchen print failed — popup was blocked. Please allow popups for this site or print manually.');
    }
  }

  const acceptOrderMut = useMutation({
    mutationFn: () => api.post<Order>(`/orders/${order.id}/accept`, {}),
    onSuccess: (updated) => {
      setOrder(updated);
      // QR orders sit at PENDING until the cashier accepts them,
      // so this is the moment the kitchen first sees the ticket.
      // Without this call the KOT silently never prints.
      void maybePrintKitchenTicket(updated);
      void queryClient.invalidateQueries({ queryKey: ['orders', 'table', order.tableId] });
      void queryClient.invalidateQueries({ queryKey: ['pending-orders'] });
    },
  });

  const cancelOrderMut = useMutation({
    mutationFn: () => api.post<Order>(`/orders/${order.id}/void`, { reason: 'Cancelled by cashier', approverId: user?.id ?? '' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tables'] });
      void queryClient.invalidateQueries({ queryKey: ['pending-orders'] });
      void navigate('/tables');
    },
  });

  const removeItemMut = useMutation({
    mutationFn: (itemId: string) => api.post<Order>(`/orders/${order.id}/items/${itemId}/cancel`, {}),
    onSuccess: (updated) => {
      setOrder(updated);
      void queryClient.invalidateQueries({ queryKey: ['orders', 'table', order.tableId] });
    },
  });

  const { data: menuItems = [] } = useQuery<MenuItem[]>({
    queryKey: ['menu'],
    queryFn: () => api.get<MenuItem[]>('/menu?includeAddons=true'),
    enabled: showAddItems,
  });

  const addItemsMutation = useMutation({
    mutationFn: (items: { menuItemId: string; quantity: number; notes?: string }[]) =>
      api.post<Order>(`/orders/${order.id}/items`, items),
    onSuccess: (updated) => {
      if (!branchSettings || !branchSettings.useKds) printNewItemsKT(updated, newItemCart);
      setOrder(updated);
      setShowAddItems(false);
      setNewItemCart([]);
      void queryClient.invalidateQueries({ queryKey: ['orders', 'table', order.tableId] });
    },
  });

  const printNewItemsKT = (ord: Order, newItems: CartItem[]) => {
    // Build a KitchenTicketInput-shaped ticket for the +ADD lines and
    // hand it to the shared printer. Routes through the desktop ESC/POS
    // path (window.desktop.print.kitchen) when available and falls back
    // to the shared HTML popup template otherwise. The previous inline
    // browser fallback rendered only quantity + name, so customise
    // ("NO GARLIC") and addon ("+ Cheese Sauce") lines vanished from
    // the +ADD ticket.
    const ticket = {
      orderNumber: `${ord.orderNumber} (+ADD)`,
      tableNumber: ord.tableNumber,
      type: ord.type,
      createdAt: new Date().toISOString(),
      items: newItems.map((c) => ({
        quantity: c.quantity,
        menuItemName: c.menuItem.name,
        menuItemId: c.menuItem.id,
        notes: c.notes ?? null,
        removedIngredients: c.removedNames && c.removedNames.length > 0 ? c.removedNames : undefined,
        selectedAddons: c.addons && c.addons.length > 0 ? c.addons.map((a) => a.addonName) : undefined,
      })),
    };
    const ok = printKitchenTicketUtil(ticket);
    if (!ok) {
      alert('Kitchen print failed — popup was blocked. Please allow popups for this site or print manually.');
    }
  };

  const voidItemMutation = useMutation({
    mutationFn: (dto: VoidOrderItemDto & { itemId: string }) =>
      api.post<Order>(`/orders/${order.id}/items/${dto.itemId}/void`, {
        reason: dto.reason,
        approverId: dto.approverId,
        logAsWaste: dto.logAsWaste,
        wasteReason: dto.wasteReason,
      }),
    onSuccess: (updated) => {
      setOrder(updated);
      setVoidingItem(null);
      void queryClient.invalidateQueries({ queryKey: ['orders', 'table', order.tableId] });
    },
  });

  const activeItems = order.items.filter((i) => !i.voidedAt);
  const pendingApprovalItems = activeItems.filter((i) => i.kitchenStatus === 'PENDING_APPROVAL');
  const voidedItems = order.items.filter((i) => i.voidedAt);
  const total = Number(order.totalAmount);
  const subtotal = Number(order.subtotal);
  const tax = Number(order.taxAmount);

  const approveAllMut = useMutation({
    mutationFn: () => api.post<Order>(`/orders/${order.id}/approve-items`, {}),
    onSuccess: (updated) => {
      setOrder(updated);
      void queryClient.invalidateQueries({ queryKey: ['orders', 'table', order.tableId] });
    },
  });

  const rejectAllMut = useMutation({
    mutationFn: () => api.post<Order>(`/orders/${order.id}/reject-items`, {}),
    onSuccess: (updated) => {
      setOrder(updated);
      void queryClient.invalidateQueries({ queryKey: ['orders', 'table', order.tableId] });
    },
  });

  const approveItemMut = useMutation({
    mutationFn: (itemId: string) => api.post<Order>(`/orders/${order.id}/items/${itemId}/approve`, {}),
    onSuccess: (updated) => {
      setOrder(updated);
      void queryClient.invalidateQueries({ queryKey: ['orders', 'table', order.tableId] });
    },
  });

  const rejectItemMut = useMutation({
    mutationFn: (itemId: string) => api.post<Order>(`/orders/${order.id}/items/${itemId}/reject`, {}),
    onSuccess: (updated) => {
      setOrder(updated);
      void queryClient.invalidateQueries({ queryKey: ['orders', 'table', order.tableId] });
    },
  });

  const setGuestCountMut = useMutation({
    mutationFn: (guestCount: number) =>
      api.patch<Order>(`/orders/${order.id}/guest-count`, { guestCount }),
    onSuccess: (updated) => {
      setOrder(updated);
      void queryClient.invalidateQueries({ queryKey: ['orders', 'table', order.tableId] });
    },
  });

  const [showDiscountPicker, setShowDiscountPicker] = useState(false);
  const [showCouponInput, setShowCouponInput] = useState(false);
  const [posCouponCode, setPosCouponCode] = useState('');
  const [custSearch, setCustSearch] = useState('');
  const [showCustForm, setShowCustForm] = useState(false);
  // When cashier clicks +Discount / +Coupon without a customer on the order,
  // we capture the intent here and open the customer-required modal. After
  // a customer is assigned, we auto-open the original discount/coupon modal.
  const [customerGateFor, setCustomerGateFor] = useState<'discount' | 'coupon' | null>(null);
  const [newCustPhone, setNewCustPhone] = useState('');
  const [newCustName, setNewCustName] = useState('');
  const [showMoveTable, setShowMoveTable] = useState(false);
  const [movingItem, setMovingItem] = useState<OrderItem | null>(null);

  const { data: availableDiscounts = [] } = useQuery<{ id: string; name: string; type: string; value: number; scope: string; isActive: boolean }[]>({
    queryKey: ['active-discounts'],
    queryFn: () => api.get('/discounts/active'),
  });

  const applyDiscountMut = useMutation({
    mutationFn: (discountId: string) => api.post<Order>(`/orders/${order.id}/apply-discount`, { discountId }),
    onSuccess: (updated) => {
      setOrder(updated);
      setShowDiscountPicker(false);
      void queryClient.invalidateQueries({ queryKey: ['orders', 'table', order.tableId] });
    },
  });

  const removeDiscountMut = useMutation({
    mutationFn: () => api.post<Order>(`/orders/${order.id}/remove-discount`, {}),
    onSuccess: (updated) => {
      setOrder(updated);
      void queryClient.invalidateQueries({ queryKey: ['orders', 'table', order.tableId] });
    },
  });

  const applyCouponMut = useMutation({
    mutationFn: (code: string) => api.post<Order>(`/orders/${order.id}/apply-coupon`, { code }),
    onSuccess: (updated) => {
      setOrder(updated);
      setShowCouponInput(false);
      setPosCouponCode('');
      void queryClient.invalidateQueries({ queryKey: ['orders', 'table', order.tableId] });
    },
  });

  const { data: custResults = [] } = useQuery<{ id: string; name: string; phone: string; totalOrders: number }[]>({
    queryKey: ['customer-search', custSearch],
    queryFn: () => api.get(`/customers/search?q=${encodeURIComponent(custSearch)}`),
    enabled: custSearch.length >= 2,
  });

  const assignCustomerMut = useMutation({
    mutationFn: (customerId: string | null) => api.post<Order>(`/customers/assign-order`, { orderId: order.id, customerId }),
    onSuccess: (updated) => {
      setOrder(updated);
      setCustSearch('');
      void queryClient.invalidateQueries({ queryKey: ['orders', 'table', order.tableId] });
      // If the cashier was gated while trying to apply a discount/coupon,
      // continue into that flow now that a customer is attached. Non-null
      // customerId is the signal that a real customer (not walk-in) was
      // picked — walk-in clears the gate without advancing.
      if (customerGateFor && (updated as any).customerId) {
        const next = customerGateFor;
        setCustomerGateFor(null);
        if (next === 'discount') setShowDiscountPicker(true);
        else setShowCouponInput(true);
      }
    },
  });

  const createCustomerMut = useMutation({
    mutationFn: () => api.post<{ id: string; name: string; phone: string }>('/customers', { phone: newCustPhone, name: newCustName || undefined }),
    onSuccess: async (c) => {
      setShowCustForm(false);
      setNewCustPhone('');
      setNewCustName('');
      assignCustomerMut.mutate((c as any).id);
    },
  });

  const { data: allTables = [] } = useQuery<{ id: string; tableNumber: string; status: string }[]>({
    queryKey: ['tables-for-move'],
    queryFn: () => api.get('/tables'),
    enabled: showMoveTable || !!movingItem,
  });

  const moveTableMut = useMutation({
    mutationFn: (newTableId: string) => api.post<Order>(`/orders/${order.id}/move-table`, { tableId: newTableId }),
    onSuccess: (updated) => {
      setOrder(updated);
      setShowMoveTable(false);
      void queryClient.invalidateQueries({ queryKey: ['tables'] });
      void queryClient.invalidateQueries({ queryKey: ['orders', 'table', order.tableId] });
    },
  });

  const moveItemMut = useMutation({
    mutationFn: ({ itemId, tableId }: { itemId: string; tableId: string }) =>
      api.post<Order>(`/orders/${order.id}/items/${itemId}/move-table`, { tableId }),
    onSuccess: (updated) => {
      setOrder(updated);
      setMovingItem(null);
      void queryClient.invalidateQueries({ queryKey: ['tables'] });
      void queryClient.invalidateQueries({ queryKey: ['orders', 'table', order.tableId] });
    },
  });

  const discount = Number(order.discountAmount);

  const STATUS_LABEL: Record<string, string> = {
    PENDING: 'Pending', CONFIRMED: 'Confirmed', PREPARING: 'Preparing',
    READY: 'Ready', SERVED: 'Served',
  };

  if (paidOrder) {
    return (
      <ReceiptModal
        order={paidOrder}
        cashReceived={cashReceived}
        onDone={() => {
          void queryClient.invalidateQueries({ queryKey: ['tables'] });
          void navigate('/tables');
        }}
      />
    );
  }

  const STATUS_PILL: Record<string, string> = {
    PENDING: 'text-theme-warn bg-theme-warn/10',
    CONFIRMED: 'text-theme-info bg-theme-info/10',
    PREPARING: 'text-theme-warn bg-theme-warn/10',
    READY: 'text-theme-pop bg-theme-pop/10',
    SERVED: 'text-theme-pop bg-theme-pop/10',
  };

  return (
    <div className="h-full flex flex-col bg-theme-bg">
      {/* Top bar */}
      <header className="h-16 bg-theme-surface border-b border-theme-border flex items-center px-6 gap-4 shrink-0">
        <button onClick={onBack} className="text-theme-text-muted hover:text-theme-accent flex items-center gap-1 text-sm font-semibold transition-colors">
          <ArrowLeft size={16} /> Tables
        </button>
        <div className="h-8 w-px bg-theme-border" />
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-extrabold text-theme-text">Order #{order.orderNumber}</h1>
          <span className="text-xs text-theme-text-muted">
            {order.tableNumber ? `Table ${order.tableNumber}` : 'Takeaway'} · {order.type}
          </span>
        </div>
        <div className="flex-1" />
        {/* Refund button — surfaces only for paid / partially-refunded orders
            on NBR-enabled branches. Issuing emits a Mushak-6.8 credit note
            linked to the original 6.3 invoice. */}
        {branding?.nbrEnabled && (order.status === 'PAID' || order.status === 'PARTIALLY_REFUNDED') && (
          <button
            onClick={() => setShowRefund(true)}
            className="text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-theme border border-theme-danger text-theme-danger hover:bg-theme-danger hover:text-white transition-colors mr-2"
          >
            Refund
          </button>
        )}
        <span className={`text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-full ${STATUS_PILL[order.status] ?? 'text-theme-text-muted bg-theme-bg'}`}>
          {STATUS_LABEL[order.status] ?? order.status}
        </span>
      </header>
      {showRefund && (
        <RefundOrderDialog
          order={order}
          onClose={() => setShowRefund(false)}
          onRefunded={() => void queryClient.invalidateQueries({ queryKey: ['orders'] })}
        />
      )}

      {/* Bill requested banner */}
      {(order as any).billRequested && order.status !== 'PAID' && (
        <div className="px-6 py-3 bg-theme-info/10 border-b-2 border-theme-info/30 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-theme-info text-white flex items-center justify-center font-bold animate-pulse">💰</div>
            <div>
              <p className="text-sm font-bold text-theme-info">Customer has requested the bill</p>
              <p className="text-[11px] text-theme-text-muted">Process payment when ready</p>
            </div>
          </div>
          <button
            onClick={() => setShowPayment(true)}
            className="bg-theme-info text-white text-xs font-bold px-4 py-2 rounded-theme hover:opacity-90 transition-opacity"
          >
            Process Payment
          </button>
        </div>
      )}

      {/* Waiter + Customer bar */}
      <div className="bg-theme-surface border-b border-theme-border px-6 py-3 flex items-center gap-6 shrink-0 flex-wrap">
        {orderWaiters.length > 0 && (
          <>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase text-theme-text-muted">Waiter</span>
              <select
                value={(order as any).waiterId ?? ''}
                onChange={(e) => { if (e.target.value) setWaiterMut.mutate(e.target.value); }}
                className="text-sm font-semibold bg-theme-bg rounded-theme px-3 py-1.5 border-0 text-theme-text outline-none"
              >
                <option value="">— Select —</option>
                {orderWaiters.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div className="h-6 w-px bg-theme-border" />
          </>
        )}
        {order.tableId && (
          <>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase text-theme-text-muted">Guests</span>
              <input
                type="number"
                min={0}
                max={99}
                defaultValue={(order as unknown as { guestCount?: number }).guestCount ?? 0}
                onBlur={(e) => {
                  const v = Math.max(0, Math.min(99, Number(e.target.value) || 0));
                  if (v !== ((order as unknown as { guestCount?: number }).guestCount ?? 0)) {
                    setGuestCountMut.mutate(v);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
                className="w-14 text-sm font-semibold bg-theme-bg rounded-theme px-2 py-1.5 border-0 text-theme-text outline-none text-center"
              />
            </div>
            <div className="h-6 w-px bg-theme-border" />
          </>
        )}
        <span className="text-[10px] font-bold uppercase text-theme-text-muted">Customer</span>
        <span className="text-xs font-theme-body font-medium font-semibold text-theme-text-muted">Customer:</span>
        {(order as any).customerName && (order as any).customerId ? (
          <div className="flex items-center gap-2">
            <span className="text-sm font-theme-body text-theme-text font-medium">{(order as any).customerName}</span>
            {(order as any).customerPhone && <span className="text-xs font-theme-body text-theme-text-muted">{(order as any).customerPhone}</span>}
            <button onClick={() => assignCustomerMut.mutate(null)} className="text-theme-text-muted hover:text-theme-accent text-xs">✕</button>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-1">
            <div className="relative flex-1 max-w-xs">
              <input
                value={custSearch}
                onChange={(e) => setCustSearch(e.target.value)}
                placeholder="Search phone or name..."
                className="w-full border border-theme-border px-3 py-1.5 text-sm font-theme-body text-theme-text outline-none focus:border-theme-accent bg-theme-surface"
              />
              {custSearch.length >= 2 && custResults.length > 0 && (
                <div className="absolute top-full left-0 w-full bg-theme-surface border border-theme-border shadow-lg z-10 max-h-40 overflow-auto">
                  {custResults.map((c) => (
                    <button key={c.id} onClick={() => assignCustomerMut.mutate(c.id)}
                      className="w-full text-left px-3 py-2 text-sm font-theme-body hover:bg-theme-surface-alt flex justify-between border-b border-theme-surface-alt last:border-0">
                      <span className="text-theme-text">{c.name}</span>
                      <span className="text-theme-text-muted text-xs">{c.phone} ({c.totalOrders} orders)</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {!showCustForm ? (
              <button onClick={() => setShowCustForm(true)} className="text-xs font-theme-body text-theme-accent hover:underline font-semibold whitespace-nowrap">+ New</button>
            ) : (
              <div className="flex items-center gap-1.5">
                <input value={newCustPhone} onChange={(e) => setNewCustPhone(e.target.value)} placeholder="Phone"
                  className="border border-theme-border px-2 py-1 text-xs font-theme-body w-28 outline-none focus:border-theme-accent" />
                <input value={newCustName} onChange={(e) => setNewCustName(e.target.value)} placeholder="Name"
                  className="border border-theme-border px-2 py-1 text-xs font-theme-body w-24 outline-none focus:border-theme-accent" />
                <button onClick={() => createCustomerMut.mutate()} disabled={!newCustPhone || createCustomerMut.isPending}
                  className="bg-theme-accent text-white text-[10px] px-2 py-1 font-theme-body disabled:opacity-40">Add</button>
                <button onClick={() => setShowCustForm(false)} className="text-theme-text-muted text-xs">✕</button>
              </div>
            )}
            <button onClick={() => assignCustomerMut.mutate(null)}
              className="text-xs font-theme-body text-theme-text-muted border border-theme-border px-2 py-1 hover:border-theme-text whitespace-nowrap">Walk-in</button>
          </div>
        )}
        {assignCustomerMut.isPending && <span className="text-theme-text-muted font-theme-body text-xs">Saving...</span>}
      </div>

      {/* Pending approval banner */}
      {pendingApprovalItems.length > 0 && (
        <div className="bg-theme-danger/10 border-b-2 border-theme-danger/30 px-6 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-theme-danger text-white flex items-center justify-center font-bold animate-pulse">🔔</div>
            <div>
              <p className="text-sm font-bold text-theme-danger">
                {pendingApprovalItems.length} new item{pendingApprovalItems.length > 1 ? 's' : ''} from QR customer
              </p>
              <p className="text-[11px] text-theme-text-muted">Awaiting your approval before they go to kitchen</p>
            </div>
          </div>
          {pendingApprovalItems.length > 1 && (
            <div className="flex gap-2">
              <button
                onClick={() => rejectAllMut.mutate()}
                disabled={rejectAllMut.isPending}
                className="border-2 border-theme-danger text-theme-danger font-semibold px-4 py-2 rounded-theme text-sm hover:bg-theme-danger hover:text-white transition-colors disabled:opacity-40"
              >
                Reject All
              </button>
              <button
                onClick={() => approveAllMut.mutate()}
                disabled={approveAllMut.isPending}
                className="bg-theme-danger text-white font-bold px-4 py-2 rounded-theme text-sm hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                Approve All
              </button>
            </div>
          )}
        </div>
      )}

      {/* Items + Summary split */}
      <div className="flex-1 flex overflow-hidden">
      <section className="flex-1 overflow-auto p-6">
      <div className="bg-theme-surface rounded-theme border border-theme-border overflow-hidden">
        <div className="px-5 py-3 border-b border-theme-border flex items-center justify-between">
          <h3 className="text-sm font-bold text-theme-text">Items ({activeItems.length})</h3>
          <span className="text-[10px] text-theme-text-muted">Auto-refreshing</span>
        </div>
        {/* Active items */}
        <div className="divide-y divide-theme-border">
          {activeItems.map((item) => {
            const isPendingApproval = item.kitchenStatus === 'PENDING_APPROVAL';
            const ks = item.kitchenStatus;
            const STATUS_PILL: Record<string, string> = {
              READY:    'text-theme-pop bg-theme-pop/10',
              PREPARING:'text-theme-warn bg-theme-warn/10',
              SERVED:   'text-theme-pop bg-theme-pop/10',
              QUEUED:   'text-theme-text-muted bg-theme-bg',
            };
            const statusLabel: Record<string, string> = {
              READY: 'DONE', PREPARING: 'PREPARING', SERVED: 'SERVED', QUEUED: 'QUEUED',
            };
            return (
              <div key={item.id} className={`px-5 py-3 ${isPendingApproval ? 'bg-theme-danger/5' : ''}`}>
                <div className="flex items-start gap-3">
                  <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                    isPendingApproval ? 'bg-theme-danger text-white' : 'bg-theme-bg text-theme-text'
                  }`}>
                    {item.quantity}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-theme-text">{item.menuItemName}</p>
                      {isPendingApproval ? (
                        <span className="text-[9px] font-bold uppercase text-theme-danger bg-theme-surface px-1.5 py-0.5 rounded">NEW · AWAITING</span>
                      ) : ks && STATUS_PILL[ks] ? (
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${STATUS_PILL[ks]}`}>
                          {statusLabel[ks]}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-[11px] text-theme-text-muted mt-0.5">
                      {item.quantity} × {formatCurrency(Number(item.unitPrice))}
                    </p>
                    {item.notes && (
                      <p className="text-[11px] text-theme-accent mt-0.5 flex items-center gap-1">📝 {item.notes}</p>
                    )}
                    {(order.status === 'PENDING' || order.status === 'CONFIRMED') && (
                      <button
                        onClick={() => {
                          const note = prompt(item.notes ? 'Edit note:' : 'Add note for this item:', item.notes ?? '');
                          if (note !== null) api.patch(`/orders/${order.id}/items/${item.id}/notes`, { notes: note }).then(() => queryClient.invalidateQueries({ queryKey: ['orders', 'table', order.tableId] }));
                        }}
                        className="text-[10px] text-theme-text-muted hover:text-theme-accent mt-0.5"
                      >
                        {item.notes ? 'Edit note' : '+ Add note'}
                      </button>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className="text-sm font-extrabold text-theme-text">{formatCurrency(Number(item.totalPrice))}</span>
                    {isPendingApproval ? (
                      <div className="flex gap-1">
                        <button
                          onClick={() => rejectItemMut.mutate(item.id)}
                          disabled={rejectItemMut.isPending}
                          title="Reject"
                          className="w-7 h-7 rounded-theme border-2 border-theme-danger text-theme-danger hover:bg-theme-danger hover:text-white flex items-center justify-center transition-colors disabled:opacity-40"
                        >
                          <X size={12} />
                        </button>
                        <button
                          onClick={() => approveItemMut.mutate(item.id)}
                          disabled={approveItemMut.isPending}
                          title="Approve"
                          className="w-7 h-7 rounded-theme bg-theme-pop text-white hover:opacity-90 flex items-center justify-center transition-opacity disabled:opacity-40 text-sm font-bold"
                        >
                          ✓
                        </button>
                      </div>
                    ) : order.status === 'PENDING' ? (
                      <button
                        onClick={() => removeItemMut.mutate(item.id)}
                        disabled={removeItemMut.isPending}
                        className="text-[10px] text-theme-text-muted hover:text-theme-danger transition-colors"
                      >
                        Remove
                      </button>
                    ) : (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setMovingItem(item)}
                          className="text-[10px] text-theme-text-muted hover:text-theme-accent transition-colors"
                          title="Move this item to another table"
                        >
                          Move
                        </button>
                        <span className="text-theme-border">·</span>
                        <button
                          onClick={() => setVoidingItem(item)}
                          disabled={!online}
                          title={online ? undefined : 'Voids need internet (manager approval)'}
                          className="text-[10px] text-theme-text-muted hover:text-theme-danger disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-theme-text-muted transition-colors"
                        >
                          Void{!online ? ' · offline' : ''}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Voided items */}
        {voidedItems.length > 0 && (
          <div className="border-t border-theme-border bg-theme-bg/40 px-5 py-3">
            <p className="text-[9px] font-bold uppercase tracking-wider text-theme-text-muted mb-2">Voided</p>
            {voidedItems.map((item) => (
              <div key={item.id} className="flex items-center justify-between py-1 opacity-50">
                <div className="flex items-center gap-3">
                  <span className="w-7 h-7 rounded-full bg-theme-surface border border-theme-border flex items-center justify-center text-xs font-bold">
                    {item.quantity}
                  </span>
                  <p className="text-sm font-semibold line-through text-theme-text">{item.menuItemName}</p>
                </div>
                <span className="text-sm font-bold line-through text-theme-text">{formatCurrency(Number(item.totalPrice))}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      </section>

      {/* Right summary panel */}
      <aside className="w-[400px] bg-theme-surface border-l border-theme-border flex flex-col shrink-0">
      <div className="p-5 space-y-2 flex-1 overflow-auto">
        <div className="flex justify-between text-sm font-theme-body text-theme-text-muted">
          <span>Subtotal</span><span>{formatCurrency(subtotal)}</span>
        </div>
        {discount > 0 && (
          <div className="flex justify-between text-sm font-theme-body text-green-600">
            <span className="flex items-center gap-1">
              {(order as any).discountName || 'Discount'}
              {(order as any).couponCode && <span className="text-[10px] bg-green-600/10 px-1.5 py-0.5 font-semibold">{(order as any).couponCode}</span>}
            </span>
            <span className="flex items-center gap-2">
              -{formatCurrency(discount)}
              {order.status !== 'PAID' && (
                <button onClick={() => removeDiscountMut.mutate()} className="text-theme-border hover:text-theme-accent text-[10px]">✕</button>
              )}
            </span>
          </div>
        )}
        <div className="flex justify-between text-sm font-theme-body text-theme-text-muted">
          <span>VAT</span><span>{formatCurrency(tax)}</span>
        </div>
        <div className="flex justify-between font-theme-display text-2xl tracking-wide pt-1">
          <span>TOTAL</span>
          <span className="text-theme-accent">{formatCurrency(total)}</span>
        </div>
        {/* Discount / Coupon controls */}
        {discount === 0 && order.status !== 'PAID' && order.status !== 'VOID' && (
          <div className="pt-2 space-y-1">
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  if (!(order as any).customerId) { setCustomerGateFor('discount'); return; }
                  setShowDiscountPicker(true); setShowCouponInput(false);
                }}
                className="flex-1 bg-theme-bg hover:bg-theme-surface-alt text-theme-text font-semibold py-2 rounded-theme text-xs transition-colors"
              >
                + Discount
              </button>
              <button
                onClick={() => {
                  if (!online) return;
                  if (!(order as any).customerId) { setCustomerGateFor('coupon'); return; }
                  setShowCouponInput(true); setShowDiscountPicker(false);
                }}
                disabled={!online}
                title={online ? undefined : 'Coupon codes need internet to validate'}
                className="flex-1 bg-theme-bg hover:bg-theme-surface-alt disabled:opacity-40 disabled:cursor-not-allowed text-theme-text font-semibold py-2 rounded-theme text-xs transition-colors"
              >
                + Coupon
              </button>
            </div>
            {!online && (
              <div className="flex justify-end pr-1">
                <OfflineInlineHint label="Coupon needs internet" />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="p-4 border-t border-theme-border flex flex-wrap gap-2">
          {/* PENDING: Accept, Add Items, Cancel */}
          {order.status === 'PENDING' && (
            <>
              <button
                onClick={() => { if (confirm('Cancel this QR order? The customer will be notified.')) cancelOrderMut.mutate(); }}
                disabled={cancelOrderMut.isPending}
                className="flex items-center gap-1.5 px-4 py-3 border border-theme-border text-theme-accent hover:border-theme-accent text-sm font-theme-body transition-colors disabled:opacity-40"
              >
                {cancelOrderMut.isPending ? 'Cancelling…' : 'Cancel Order'}
              </button>
              <button
                onClick={() => setShowAddItems(true)}
                className="flex items-center gap-1.5 px-4 py-3 border border-theme-border text-theme-text-muted hover:border-theme-text hover:text-theme-text text-sm font-theme-body transition-colors"
              >
                <Plus size={14} />
                Edit Items
              </button>
              <button
                onClick={() => acceptOrderMut.mutate()}
                disabled={acceptOrderMut.isPending || activeItems.length === 0}
                className="flex-1 bg-theme-pop hover:opacity-90 text-white flex items-center justify-center gap-2 py-3 rounded-theme font-bold text-sm transition-opacity disabled:opacity-40"
              >
                {acceptOrderMut.isPending ? 'Accepting…' : '✓ Accept → Kitchen'}
              </button>
            </>
          )}
          {order.status !== 'PENDING' && (
            <>
              <button
                onClick={() => setShowBill(true)}
                disabled={activeItems.length === 0}
                className="flex items-center gap-1.5 px-4 py-3 border border-theme-border text-theme-text-muted hover:border-theme-text hover:text-theme-text text-sm font-theme-body transition-colors disabled:opacity-40"
              >
                <Printer size={14} />
                Bill
              </button>
              {/* Move Table */}
              {order.tableId && (
                <button
                  onClick={() => setShowMoveTable(true)}
                  className="flex items-center gap-1.5 px-4 py-3 bg-theme-bg hover:bg-theme-surface-alt rounded-theme text-theme-text font-semibold text-sm transition-colors"
                >
                  Move Table
                </button>
              )}
              <button
                onClick={() => setShowAddItems(true)}
                className="flex items-center gap-1.5 px-4 py-3 border border-theme-border text-theme-text-muted hover:border-theme-text hover:text-theme-text text-sm font-theme-body transition-colors"
              >
                <Plus size={14} />
                Add Items
              </button>
              <button
                onClick={() => setShowPayment(true)}
                disabled={activeItems.length === 0}
                className="flex-1 bg-theme-pop hover:opacity-90 text-white flex items-center justify-center gap-2 py-3 rounded-theme font-bold text-sm transition-opacity disabled:opacity-40"
              >
                <ShoppingBag size={16} />
                Process Payment
              </button>
            </>
          )}
        </div>
      </aside>
      </div>

      {showAddItems && (
        <AddItemsOverlay
          menuItems={menuItems}
          newItemCart={newItemCart}
          setNewItemCart={setNewItemCart}
          onClose={() => { setShowAddItems(false); setNewItemCart([]); }}
          onSubmit={() => addItemsMutation.mutate(newItemCart.map((c) => ({
            menuItemId: c.menuItem.id,
            quantity: c.quantity,
            notes: c.notes || undefined,
            removedIngredientIds: c.removedIngredientIds && c.removedIngredientIds.length > 0 ? c.removedIngredientIds : undefined,
            addons: c.addons && c.addons.length > 0 ? c.addons.map((a) => ({ groupId: a.groupId, addonItemId: a.addonItemId })) : undefined,
          })))}
          isPending={addItemsMutation.isPending}
          orderNumber={order.orderNumber}
        />
      )}

      {showBill && (
        <BillModal order={order} onClose={() => setShowBill(false)} />
      )}

      {showPayment && (
        <PaymentModal
          order={order}
          onClose={() => setShowPayment(false)}
          onSuccess={(paid, cash) => {
            setShowPayment(false);
            setPaidOrder(paid);
            setCashReceived(cash);
          }}
        />
      )}

      {voidingItem && (
        <VoidItemDialog
          item={voidingItem}
          orderId={order.id}
          isCashier={isCashier}
          onClose={() => setVoidingItem(null)}
          isPending={voidItemMutation.isPending}
          error={voidItemMutation.isError ? (voidItemMutation.error as Error).message : undefined}
          onConfirm={(dto) =>
            voidItemMutation.mutate({ ...dto, itemId: voidingItem.id })
          }
        />
      )}

      {/* Customer-required gate: cashier tried to apply a discount/coupon
          without a customer on the order. Pick one here (or add a new one),
          then the original discount/coupon modal opens automatically. */}
      {customerGateFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setCustomerGateFor(null)}>
          <div className="bg-theme-surface rounded-theme shadow-2xl w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <header className="px-5 py-4 border-b border-theme-border flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wider text-theme-text-muted">
                Customer Required — {customerGateFor === 'discount' ? 'Discount' : 'Coupon'}
              </p>
              <button onClick={() => setCustomerGateFor(null)} className="w-7 h-7 rounded-theme hover:bg-theme-bg flex items-center justify-center text-theme-text-muted">
                <X size={14} />
              </button>
            </header>
            <div className="p-5 space-y-4">
              <p className="text-sm text-theme-text-muted">
                Select an existing customer or add a new one to apply {customerGateFor === 'discount' ? 'a discount' : 'a coupon'}.
                Applying without a customer is not allowed — discounts and coupons are tracked per customer.
              </p>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-1">Search</label>
                <input
                  value={custSearch}
                  onChange={(e) => setCustSearch(e.target.value)}
                  placeholder="Phone or name…"
                  autoFocus
                  className="w-full bg-theme-bg rounded-theme px-4 py-2.5 text-sm text-theme-text outline-none border border-transparent focus:border-theme-accent"
                />
                {custSearch.length >= 2 && custResults.length > 0 && (
                  <div className="mt-2 border border-theme-border rounded-theme max-h-40 overflow-auto bg-theme-bg">
                    {custResults.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => assignCustomerMut.mutate(c.id)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-theme-surface-alt flex justify-between border-b border-theme-surface-alt last:border-0"
                      >
                        <span className="text-theme-text">{c.name}</span>
                        <span className="text-theme-text-muted text-xs">{c.phone} ({c.totalOrders} orders)</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t border-theme-border pt-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-2">Or add new</p>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={newCustPhone}
                    onChange={(e) => setNewCustPhone(e.target.value)}
                    placeholder="Phone"
                    className="bg-theme-bg rounded-theme px-3 py-2 text-sm text-theme-text outline-none border border-transparent focus:border-theme-accent"
                  />
                  <input
                    value={newCustName}
                    onChange={(e) => setNewCustName(e.target.value)}
                    placeholder="Name"
                    className="bg-theme-bg rounded-theme px-3 py-2 text-sm text-theme-text outline-none border border-transparent focus:border-theme-accent"
                  />
                </div>
                <button
                  onClick={() => createCustomerMut.mutate()}
                  disabled={!newCustPhone || createCustomerMut.isPending}
                  className="mt-2 w-full bg-theme-accent text-white font-bold py-2 rounded-theme text-sm hover:opacity-90 disabled:opacity-40"
                >
                  {createCustomerMut.isPending ? 'Adding…' : 'Add & Continue'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Discount picker modal */}
      {showDiscountPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowDiscountPicker(false)}>
          <div className="bg-theme-surface rounded-theme shadow-2xl w-full max-w-sm overflow-hidden flex flex-col max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
            <header className="px-5 py-4 border-b border-theme-border flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wider text-theme-text-muted">Apply Discount</p>
              <button onClick={() => setShowDiscountPicker(false)} className="w-7 h-7 rounded-theme hover:bg-theme-bg flex items-center justify-center text-theme-text-muted">
                <X size={14} />
              </button>
            </header>
            <div className="p-3 space-y-1 overflow-auto">
              {availableDiscounts.length === 0 ? (
                <p className="text-center text-sm text-theme-text-muted py-6">No discounts available</p>
              ) : (
                availableDiscounts.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => applyDiscountMut.mutate(d.id)}
                    className="w-full text-left p-3 rounded-theme hover:bg-theme-bg flex items-center justify-between transition-colors"
                  >
                    <div>
                      <p className="text-sm font-semibold text-theme-text">{d.name}</p>
                      <p className="text-[10px] text-theme-text-muted">All items · {d.type === 'FLAT' ? `${formatCurrency(Number(d.value))} off` : `${d.value}% off`}</p>
                    </div>
                    <span className="text-xs font-bold text-theme-pop">{d.type === 'FLAT' ? `-${formatCurrency(Number(d.value))}` : `-${d.value}%`}</span>
                  </button>
                ))
              )}
            </div>
            <div className="border-t border-theme-border p-3">
              <button
                onClick={() => { setShowDiscountPicker(false); setShowCouponInput(true); }}
                className="w-full text-theme-accent text-xs font-bold uppercase tracking-wider py-2 hover:underline"
              >
                — or use Coupon Code instead —
              </button>
            </div>
            {applyDiscountMut.isError && (
              <p className="px-5 pb-3 text-xs text-theme-danger text-center">{(applyDiscountMut.error as Error).message}</p>
            )}
          </div>
        </div>
      )}

      {/* Coupon code modal */}
      {showCouponInput && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => { setShowCouponInput(false); setPosCouponCode(''); }}>
          <div className="bg-theme-surface rounded-theme shadow-2xl w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <header className="px-5 py-4 border-b border-theme-border flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wider text-theme-text-muted">Coupon Code</p>
              <button onClick={() => { setShowCouponInput(false); setPosCouponCode(''); }} className="w-7 h-7 rounded-theme hover:bg-theme-bg flex items-center justify-center text-theme-text-muted">
                <X size={14} />
              </button>
            </header>
            <div className="p-5 space-y-3">
              <input
                value={posCouponCode}
                onChange={(e) => setPosCouponCode(e.target.value.toUpperCase())}
                placeholder="ENTER CODE"
                autoFocus
                className="w-full bg-theme-bg rounded-theme px-4 py-3 text-base font-bold font-mono tracking-widest text-center text-theme-text outline-none border border-transparent focus:border-theme-accent uppercase"
              />
              <button
                onClick={() => applyCouponMut.mutate(posCouponCode)}
                disabled={!posCouponCode.trim() || applyCouponMut.isPending}
                className="w-full bg-theme-pop text-white font-bold py-3 rounded-theme hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                {applyCouponMut.isPending ? 'Applying…' : 'Apply Coupon'}
              </button>
              {applyCouponMut.isError && (
                <p className="text-xs text-theme-danger text-center">{(applyCouponMut.error as Error).message}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Move single item to another table */}
      {movingItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setMovingItem(null)}
        >
          <div
            className="bg-theme-surface rounded-theme shadow-2xl w-full max-w-md max-h-[85vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="px-6 py-4 border-b border-theme-border flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-theme-text">Move Item</h3>
                <p className="text-xs text-theme-text-muted mt-0.5 truncate">
                  {movingItem.quantity}× {movingItem.menuItemName} → pick destination table
                </p>
              </div>
              <button
                onClick={() => setMovingItem(null)}
                className="w-8 h-8 rounded-theme hover:bg-theme-bg flex items-center justify-center text-theme-text-muted"
              >
                <X size={16} />
              </button>
            </header>

            <div className="p-6 overflow-auto">
              <div className="grid grid-cols-4 gap-3">
                {allTables
                  .filter((t) => t.id !== order.tableId)
                  .map((t) => {
                    const isVacant = t.status === 'AVAILABLE';
                    const isOccupied = t.status === 'OCCUPIED';
                    const enabled = isVacant || isOccupied;
                    return (
                      <button
                        key={t.id}
                        onClick={() => enabled && moveItemMut.mutate({ itemId: movingItem.id, tableId: t.id })}
                        disabled={!enabled || moveItemMut.isPending}
                        className={`aspect-square rounded-theme border-2 flex flex-col items-center justify-center transition-colors ${
                          isVacant
                            ? 'bg-theme-pop-soft border-theme-pop text-theme-text hover:bg-theme-pop hover:text-white'
                            : isOccupied
                              ? 'bg-theme-accent-soft border-theme-accent text-theme-text hover:bg-theme-accent hover:text-white'
                              : 'bg-theme-bg border-theme-border text-theme-text-muted opacity-50 cursor-not-allowed'
                        }`}
                      >
                        <span className="text-base font-bold">{t.tableNumber}</span>
                        <span className="text-[9px] uppercase">
                          {isVacant ? 'vacant' : isOccupied ? 'add to' : t.status.toLowerCase().slice(0, 4)}
                        </span>
                      </button>
                    );
                  })}
              </div>

              {allTables.filter((t) => t.id !== order.tableId).length === 0 && (
                <p className="text-center text-sm text-theme-text-muted py-8">No other tables</p>
              )}

              <p className="text-[10px] text-theme-text-muted text-center mt-4">
                Vacant tables will get a new order. Occupied tables will receive this item into their existing order.
              </p>

              {moveItemMut.isError && (
                <p className="text-xs text-theme-danger text-center mt-3">
                  {(moveItemMut.error as Error).message}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Move Table modal */}
      {showMoveTable && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setShowMoveTable(false)}
        >
          <div
            className="bg-theme-surface rounded-theme shadow-2xl w-full max-w-md max-h-[85vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="px-6 py-4 border-b border-theme-border flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-theme-text">Move To Table</h3>
                <p className="text-xs text-theme-text-muted mt-0.5">
                  Currently at Table {order.tableNumber}
                </p>
              </div>
              <button
                onClick={() => setShowMoveTable(false)}
                className="w-8 h-8 rounded-theme hover:bg-theme-bg flex items-center justify-center text-theme-text-muted"
              >
                <X size={16} />
              </button>
            </header>

            <div className="p-6 overflow-auto">
              <div className="grid grid-cols-4 gap-3">
                {allTables
                  .filter((t) => t.id !== order.tableId)
                  .map((t) => {
                    const isVacant = t.status === 'AVAILABLE';
                    return (
                      <button
                        key={t.id}
                        onClick={() => isVacant && moveTableMut.mutate(t.id)}
                        disabled={!isVacant || moveTableMut.isPending}
                        className={`aspect-square rounded-theme border-2 flex flex-col items-center justify-center transition-colors ${
                          isVacant
                            ? 'bg-theme-pop-soft border-theme-pop text-theme-text hover:bg-theme-pop hover:text-white'
                            : 'bg-theme-bg border-theme-border text-theme-text-muted opacity-50 cursor-not-allowed'
                        }`}
                      >
                        <span className="text-base font-bold">{t.tableNumber}</span>
                        <span className="text-[9px] uppercase">
                          {isVacant ? 'vacant' : t.status.toLowerCase().slice(0, 4)}
                        </span>
                      </button>
                    );
                  })}
              </div>

              {allTables.filter((t) => t.id !== order.tableId).length === 0 && (
                <p className="text-center text-sm text-theme-text-muted py-8">No other tables</p>
              )}

              <p className="text-[10px] text-theme-text-muted text-center mt-4">
                QR customer will see updated table number automatically.
              </p>

              {moveTableMut.isError && (
                <p className="text-xs text-theme-danger text-center mt-3">
                  {(moveTableMut.error as Error).message}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── New Order View ───────────────────────────────────────────────────────────

function NewOrderView({
  tableId,
  tableNumber,
  onBack,
}: {
  tableId?: string;
  tableNumber: string;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [waiterId, setWaiterId] = useState<string>('');
  const [guestCount, setGuestCount] = useState<number>(0);
  const [hoverIdx, setHoverIdx] = useState(0);
  const [showCustomMenu, setShowCustomMenu] = useState(false);
  const [variantPickerFor, setVariantPickerFor] = useState<MenuItem | null>(null);
  const [customizingKey, setCustomizingKey] = useState<string | null>(null);
  const [addonPickerFor, setAddonPickerFor] = useState<MenuItem | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const { data: cashierPerms } = useCashierPermissions();
  const customMenuPerm = cashierPerms?.createCustomMenu;
  const canCreateCustom = !!customMenuPerm?.enabled && customMenuPerm.approval !== 'NONE';

  const { data: menuItems = [] } = useQuery<MenuItem[]>({
    queryKey: ['menu'],
    queryFn: () => api.get<MenuItem[]>('/menu?includeAddons=true'),
  });

  // Lookup of a parent's children. Variants stay in the flat /menu
  // response so reports / lookups keep working; we just hide them
  // from the grid (the parent shell represents them) and route picks
  // through the variant chooser.
  const variantsByParent = (() => {
    const m = new Map<string, MenuItem[]>();
    for (const item of menuItems) {
      if (item.variantParentId) {
        const arr = m.get(item.variantParentId) ?? [];
        arr.push(item);
        m.set(item.variantParentId, arr);
      }
    }
    return m;
  })();

  const { data: waiters = [] } = useQuery<{ id: string; name: string; role: string; isActive: boolean }[]>({
    queryKey: ['waiters'],
    queryFn: () => api.get('/staff'),
    select: (d: any[]) => d.filter((s) => s.isActive && s.role !== 'KITCHEN'),
  });

  // Fetch categories for proper hierarchy
  const { data: apiCats = [] } = useQuery<{ id: string; name: string; parentId: string | null }[]>({
    queryKey: ['menu-categories'],
    queryFn: () => api.get('/menu/categories'),
  });
  const topCats = apiCats.filter((c) => !c.parentId).sort((a, b) => a.name.localeCompare(b.name));
  const getSubCats = (pid: string) => apiCats.filter((c) => c.parentId === pid).sort((a, b) => a.name.localeCompare(b.name));

  const searchTrimmed = search.trim().toLowerCase();
  const childIdsOfActive = activeCategory ? getSubCats(activeCategory).map((c) => c.id) : [];
  const filtered = menuItems
    // Hide variant children — the parent shell card represents them
    // in the grid; clicking the parent opens a chooser. Hide custom
    // one-off menu items too (they live inside their order, not the
    // standard grid).
    .filter((m) => !m.variantParentId && !m.isCustom && !m.isAddon)
    .filter((m) => {
      if (searchTrimmed) return m.name.toLowerCase().includes(searchTrimmed);
      if (!activeCategory) return true;
      return m.categoryId === activeCategory || childIdsOfActive.includes(m.categoryId);
    });

  const subtotal = cart.reduce((s, c) => {
    const addonsTotal = (c.addons ?? []).reduce((a, b) => a + b.price, 0);
    return s + (Number(c.menuItem.price) + addonsTotal) * c.quantity;
  }, 0);

  const addToCart = (item: MenuItem) => {
    // Parent shells have no price + no recipe — open the variant chooser
    // instead of dropping the shell into the cart.
    if (item.isVariantParent) {
      setVariantPickerFor(item);
      return;
    }
    // Items with addon groups go through the addon chooser before
    // landing in the cart. Empty groups (admin saved 0 options) skip.
    const groups = (item.addonGroups ?? []).filter((g) => g.options.length > 0);
    if (groups.length > 0) {
      setAddonPickerFor(item);
      return;
    }
    setCart((prev) => {
      // Match by line key: same menu item + same removed set + same
      // addons + same notes = stack on the same row. Default new tap
      // = no addons / removals.
      const key = cartLineKey({ menuItem: { id: item.id } });
      const existing = prev.find((c) => cartLineKey(c) === key);
      if (existing) return prev.map((c) => cartLineKey(c) === key ? { ...c, quantity: c.quantity + 1 } : c);
      return [...prev, { menuItem: item, quantity: 1 }];
    });
  };

  // ── Keyboard navigation (mirrors AddItemsOverlay) ──────────────────────
  const availableItems = filtered.filter((m) => m.isAvailable);
  const GRID_COLS = 5;
  const clampIdx = (i: number) => Math.max(0, Math.min(availableItems.length - 1, i));

  useEffect(() => { setHoverIdx(0); }, [search, activeCategory, availableItems.length]);

  // Autofocus the search input on mount so typing starts filtering immediately.
  useEffect(() => {
    const id = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';

      if (e.key === 'Escape') {
        if (search) { setSearch(''); e.preventDefault(); }
        return;
      }
      if (!typing && isPlainCharKey(e)) {
        e.preventDefault();
        setSearch((prev) => prev + e.key);
        setActiveCategory(null);
        searchRef.current?.focus();
        return;
      }
      if (!typing && e.key === 'Backspace' && search) {
        e.preventDefault();
        setSearch((prev) => prev.slice(0, -1));
        searchRef.current?.focus();
        return;
      }
      if (availableItems.length === 0) return;
      if (e.key === 'ArrowRight') { setHoverIdx((i) => clampIdx(i + 1)); e.preventDefault(); return; }
      if (e.key === 'ArrowLeft')  { setHoverIdx((i) => clampIdx(i - 1)); e.preventDefault(); return; }
      if (e.key === 'ArrowDown')  { setHoverIdx((i) => clampIdx(i + GRID_COLS)); e.preventDefault(); return; }
      if (e.key === 'ArrowUp')    { setHoverIdx((i) => clampIdx(i - GRID_COLS)); e.preventDefault(); return; }
      if (e.key === 'Enter')      {
        const item = availableItems[hoverIdx];
        if (item) { addToCart(item); e.preventDefault(); }
        return;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableItems, hoverIdx, search]);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const child = grid.children[hoverIdx] as HTMLElement | undefined;
    if (child) child.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [hoverIdx]);

  const removeFromCart = (key: string) => {
    setCart((prev) => {
      const existing = prev.find((c) => cartLineKey(c) === key);
      if (!existing || existing.quantity <= 1) return prev.filter((c) => cartLineKey(c) !== key);
      return prev.map((c) => cartLineKey(c) === key ? { ...c, quantity: c.quantity - 1 } : c);
    });
  };

  const { data: newOrderBranchSettings } = useBranchSettings();

  // Local copy of the helper — NewOrderView is a separate function
  // component so it can't see the one declared in ActiveOrderView.
  // Same logic: skip when KDS is on, hit the desktop IPC if present,
  // otherwise pop a print window in the browser.
  async function maybePrintKitchenTicket(order: Order) {
    if (newOrderBranchSettings && newOrderBranchSettings.useKds) return;
    const desktopPrint = (window as unknown as { desktop?: { print?: { kitchen?: (t: unknown) => Promise<{ ok: boolean; message?: string }> } } }).desktop?.print?.kitchen;
    if (desktopPrint) {
      try {
        const res = await desktopPrint(order);
        if (!res?.ok) alert(`Kitchen print failed: ${res?.message ?? 'unknown error'}`);
      } catch (err) {
        alert(`Kitchen print failed: ${(err as Error).message}`);
      }
      return;
    }
    const ok = printKitchenTicketUtil(order as any);
    if (!ok) alert('Kitchen print failed — popup was blocked. Please allow popups for this site or print manually.');
  }

  const createOrderMutation = useMutation({
    mutationFn: (dto: CreateOrderDto) => api.post<Order>('/orders', dto),
    onSuccess: (order) => {
      void maybePrintKitchenTicket(order);
      void queryClient.invalidateQueries({ queryKey: ['tables'] });
      void queryClient.invalidateQueries({ queryKey: ['orders', 'table', tableId] });
      void navigate('/tables');
    },
  });

  const handlePlaceOrder = () => {
    createOrderMutation.mutate({
      tableId,
      waiterId: waiterId || undefined,
      guestCount: guestCount > 0 ? guestCount : undefined,
      type: tableId ? 'DINE_IN' : 'TAKEAWAY',
      items: cart.map((c) => ({
        menuItemId: c.menuItem.id,
        quantity: c.quantity,
        notes: c.notes || undefined,
        removedIngredientIds: c.removedIngredientIds && c.removedIngredientIds.length > 0 ? c.removedIngredientIds : undefined,
        addons: c.addons && c.addons.length > 0 ? c.addons.map((a) => ({ groupId: a.groupId, addonItemId: a.addonItemId })) : undefined,
      })),
    });
  };

  const setCartNote = (key: string, notes: string) => {
    setCart((prev) => prev.map((c) => cartLineKey(c) === key ? { ...c, notes } : c));
  };

  // (setCartLineMods inlined into the dialog onSave below.)

  return (
    <div className="h-full flex flex-col overflow-hidden bg-theme-bg">
      {/* Top bar */}
      <header className="h-16 bg-theme-surface border-b border-theme-border flex items-center px-6 gap-4 shrink-0">
        <button onClick={onBack} className="text-theme-text-muted hover:text-theme-accent flex items-center gap-1 text-sm font-semibold transition-colors">
          <ArrowLeft size={16} /> Tables
        </button>
        <div className="h-8 w-px bg-theme-border" />
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-extrabold text-theme-text">New Order</h1>
          <span className="text-xs text-theme-text-muted">
            {tableId ? `Table ${tableNumber}` : 'Takeaway'}
          </span>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
      {/* Menu panel */}
      <div className="flex-1 min-w-0 flex flex-col">

        {/* Toolbar: search + waiter */}
        <div className="px-6 pt-4 pb-3 flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-theme-text-muted pointer-events-none" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setActiveCategory(null); }}
              placeholder="Search products… (start typing anywhere)"
              className="w-full bg-theme-surface rounded-full pl-11 pr-10 py-2.5 text-sm text-theme-text outline-none border border-theme-border focus:border-theme-accent"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-theme-text-muted hover:text-theme-text"
              >
                <X size={12} />
              </button>
            )}
          </div>
          {waiters.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase text-theme-text-muted">Waiter</span>
              <select
                value={waiterId}
                onChange={(e) => setWaiterId(e.target.value)}
                className="text-sm font-semibold bg-theme-surface rounded-theme px-3 py-2 border border-theme-border text-theme-text outline-none"
              >
                <option value="">— Select —</option>
                {waiters.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>
          )}
          {tableId && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase text-theme-text-muted">Guests</span>
              <input
                type="number"
                min={0}
                max={99}
                value={guestCount || ''}
                onChange={(e) => setGuestCount(Math.max(0, Math.min(99, Number(e.target.value) || 0)))}
                placeholder="0"
                className="w-16 text-sm font-semibold bg-theme-surface rounded-theme px-3 py-2 border border-theme-border text-theme-text outline-none text-center"
              />
            </div>
          )}
          {canCreateCustom && (
            <button
              type="button"
              onClick={() => setShowCustomMenu(true)}
              className="text-xs font-bold uppercase tracking-wider bg-theme-accent text-white rounded-theme px-3 py-2 hover:opacity-90 inline-flex items-center gap-1"
              title="Create a one-off custom menu item"
            >
              <Plus size={12} /> Custom
            </button>
          )}
        </div>

        {/* Category pill tabs */}
        {!searchTrimmed && (
          <div className="px-6 pb-3">
            <div className="flex gap-1 bg-theme-surface rounded-theme p-1 border border-theme-border w-fit max-w-full overflow-x-auto">
              <button
                onClick={() => setActiveCategory(null)}
                className={`px-4 py-2 text-sm rounded-theme whitespace-nowrap transition-colors ${
                  !activeCategory ? 'font-semibold text-theme-accent border-2 border-theme-accent' : 'font-medium text-theme-text-muted hover:text-theme-text'
                }`}
              >
                All
              </button>
              {topCats.map((cat) => {
                const subs = getSubCats(cat.id);
                const isParentActive = activeCategory === cat.id;
                const isChildActive = subs.some((s) => s.id === activeCategory);
                return (
                  <button
                    key={cat.id}
                    onClick={() => setActiveCategory(cat.id)}
                    className={`px-4 py-2 text-sm rounded-theme whitespace-nowrap transition-colors ${
                      isParentActive || isChildActive
                        ? 'font-semibold text-theme-accent border-2 border-theme-accent'
                        : 'font-medium text-theme-text-muted hover:text-theme-text'
                    }`}
                  >
                    {cat.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div
          ref={gridRef}
          className="flex-1 overflow-auto px-6 pb-6 grid grid-cols-5 gap-3 content-start"
        >
          {availableItems.map((item, idx) => {
            const inCart = cart.find((c) => c.menuItem.id === item.id);
            const isHover = idx === hoverIdx;
            const childCount = item.isVariantParent ? (variantsByParent.get(item.id)?.length ?? 0) : 0;
            return (
              <button
                key={item.id}
                onClick={() => { setHoverIdx(idx); addToCart(item); }}
                className={`relative bg-theme-surface rounded-theme p-2 text-center border transition-all hover:border-theme-accent ${
                  inCart ? 'border-theme-pop border-2' : 'border-theme-border'
                } ${isHover ? 'ring-2 ring-theme-accent ring-offset-1 ring-offset-theme-bg' : ''}`}
              >
                {inCart && (
                  <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-theme-pop text-white flex items-center justify-center text-[10px] font-bold z-10">
                    {inCart.quantity}
                  </div>
                )}
                {item.isVariantParent && (
                  <div className="absolute top-1 left-1 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-white bg-theme-accent rounded-theme z-10">
                    {childCount} variants
                  </div>
                )}
                <div className="aspect-square bg-theme-bg rounded-theme mb-1.5 flex items-center justify-center overflow-hidden">
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-xl">🍽️</span>
                  )}
                </div>
                <p className="text-[11px] font-semibold text-theme-text leading-tight truncate">{item.name}</p>
                <p className="text-xs font-bold text-theme-text">
                  {item.isVariantParent ? <span className="text-theme-text-muted text-[10px]">Pick a variant</span> : formatCurrency(Number(item.price))}
                </p>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <p className="col-span-5 text-center py-12 text-theme-text-muted text-sm">No items found</p>
          )}
        </div>
      </div>

      {/* Cart panel */}
      <aside className="w-[400px] shrink-0 flex flex-col bg-theme-surface border-l border-theme-border">
        <div className="px-5 py-4 border-b border-theme-border">
          <p className="text-xs font-bold uppercase tracking-wider text-theme-text-muted">Your Order</p>
          <p className="text-xs text-theme-text-muted mt-0.5">{cart.reduce((s, c) => s + c.quantity, 0)} items</p>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-2">
          {cart.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-theme-text-muted text-sm">
              Tap items to add
            </div>
          ) : (
            cart.map((line, idx) => {
              const { menuItem, quantity, notes, removedNames, addons } = line;
              const key = cartLineKey(line);
              const addonsTotal = (addons ?? []).reduce((s, a) => s + a.price, 0);
              const unitPrice = Number(menuItem.price) + addonsTotal;
              // See the new-item overlay's matching comment — React key
              // uses the array index so a notes edit doesn't rebuild
              // the row and bounce focus onto the menu searchbar.
              return (
              <div key={idx} className="bg-theme-bg rounded-theme p-3">
                <div className="flex items-start gap-2">
                  <span className="w-7 h-7 rounded-full bg-theme-surface border border-theme-border flex items-center justify-center text-xs font-bold shrink-0">
                    {quantity}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-theme-text truncate">{menuItem.name}</p>
                    <p className="text-[11px] text-theme-text-muted">
                      {formatCurrency(unitPrice)} each
                    </p>
                    {addons && addons.length > 0 && (
                      <p className="text-[10px] text-theme-accent font-bold mt-0.5 leading-tight">
                        {addons.map((a) => `+ ${a.addonName}${a.price > 0 ? ` (${formatCurrency(a.price)})` : ''}`).join(' • ')}
                      </p>
                    )}
                    {removedNames && removedNames.length > 0 && (
                      <p className="text-[10px] text-theme-danger font-bold mt-0.5 leading-tight">
                        {removedNames.map((n) => `NO ${n.toUpperCase()}`).join(' • ')}
                      </p>
                    )}
                  </div>
                  <span className="text-sm font-bold text-theme-text shrink-0">
                    {formatCurrency(unitPrice * quantity)}
                  </span>
                </div>

                {notes !== undefined ? (
                  <div className="mt-2 flex items-center gap-1.5">
                    <input
                      autoFocus={!notes}
                      value={notes}
                      onChange={(e) => setCartNote(key, e.target.value)}
                      placeholder="e.g. extra spicy, well done"
                      className="flex-1 bg-theme-surface rounded-theme px-2 py-1 text-[11px] text-theme-text outline-none border border-theme-border focus:border-theme-accent"
                    />
                    <button
                      onClick={() => setCart((prev) => prev.map((c) => cartLineKey(c) === key ? { ...c, notes: undefined } : c))}
                      className="text-theme-text-muted hover:text-theme-danger text-xs"
                      title="Remove note"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ) : null}

                <div className="mt-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {notes === undefined && (
                      <button
                        onClick={() => setCartNote(key, '')}
                        className="text-[10px] text-theme-text-muted hover:text-theme-accent flex items-center gap-1 transition-colors"
                      >
                        📝 Note
                      </button>
                    )}
                    <button
                      onClick={() => setCustomizingKey(key)}
                      className="text-[10px] text-theme-text-muted hover:text-theme-accent flex items-center gap-1 transition-colors"
                      title="Remove ingredients (no garlic, no peanut, etc.)"
                    >
                      🍴 Customise
                    </button>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => removeFromCart(key)}
                      className="w-6 h-6 rounded-full bg-theme-surface border border-theme-border flex items-center justify-center hover:border-theme-accent hover:text-theme-accent transition-colors"
                    >
                      <Minus size={10} />
                    </button>
                    <span className="w-4 text-center text-xs font-bold">{quantity}</span>
                    <button
                      onClick={() => {
                        // Re-add with the same mod set so the line stays merged.
                        setCart((prev) => prev.map((c) => cartLineKey(c) === key ? { ...c, quantity: c.quantity + 1 } : c));
                      }}
                      className="w-6 h-6 rounded-full bg-theme-surface border border-theme-border flex items-center justify-center hover:border-theme-accent hover:text-theme-accent transition-colors"
                    >
                      <Plus size={10} />
                    </button>
                  </div>
                </div>
              </div>
              );
            })
          )}
        </div>

        <div className="border-t border-theme-border p-5">
          <div className="space-y-1.5 mb-4">
            <div className="flex justify-between text-sm">
              <span className="text-theme-text-muted">Subtotal</span>
              <span className="font-semibold">{formatCurrency(subtotal)}</span>
            </div>
            <p className="text-[11px] text-theme-text-muted">Tax calculated at checkout</p>
            <div className="border-t border-theme-border pt-2 mt-2 flex justify-between items-baseline">
              <span className="text-base font-bold">Grand Total</span>
              <span className="text-2xl font-extrabold text-theme-text">{formatCurrency(subtotal)}</span>
            </div>
          </div>

          {createOrderMutation.isError && (
            <p className="text-xs text-theme-danger mb-3 text-center">
              {(createOrderMutation.error as Error).message}
            </p>
          )}

          <button
            onClick={handlePlaceOrder}
            disabled={cart.length === 0 || createOrderMutation.isPending}
            className="w-full bg-theme-pop hover:opacity-90 text-white flex items-center justify-center gap-2 py-4 rounded-theme font-bold text-sm transition-opacity disabled:opacity-40"
          >
            <ShoppingBag size={16} />
            {createOrderMutation.isPending ? 'Placing…' : 'Place Order'}
          </button>
        </div>
      </aside>
      </div>

      {showCustomMenu && customMenuPerm && (
        <CustomMenuDialog
          approval={customMenuPerm.approval === 'OTP' ? 'OTP' : 'AUTO'}
          onClose={() => setShowCustomMenu(false)}
          onCreated={(item) => {
            setCart((prev) => [...prev, { menuItem: item, quantity: 1 }]);
            setShowCustomMenu(false);
          }}
        />
      )}

      {variantPickerFor && (
        <VariantPickerDialog
          parent={variantPickerFor}
          variants={variantsByParent.get(variantPickerFor.id) ?? []}
          onClose={() => setVariantPickerFor(null)}
          onPick={(variant) => {
            setVariantPickerFor(null);
            // If the variant has addon groups, chain into the addon
            // chooser instead of dropping straight into the cart.
            const groups = (variant.addonGroups ?? []).filter((g) => g.options.length > 0);
            if (groups.length > 0) {
              setAddonPickerFor(variant);
              return;
            }
            setCart((prev) => {
              const key = cartLineKey({ menuItem: { id: variant.id } });
              const existing = prev.find((c) => cartLineKey(c) === key);
              if (existing) return prev.map((c) => cartLineKey(c) === key ? { ...c, quantity: c.quantity + 1 } : c);
              return [...prev, { menuItem: variant, quantity: 1 }];
            });
          }}
        />
      )}

      {addonPickerFor && (
        <AddonPickerDialog
          menuItem={addonPickerFor}
          groups={(addonPickerFor.addonGroups ?? []).filter((g) => g.options.length > 0)}
          onClose={() => setAddonPickerFor(null)}
          onSave={(picks) => {
            const item = addonPickerFor;
            setAddonPickerFor(null);
            setCart((prev) => {
              const newLine = { menuItem: item, quantity: 1, addons: picks };
              const key = cartLineKey({ menuItem: { id: item.id }, addons: picks });
              const existing = prev.find((c) => cartLineKey(c) === key);
              if (existing) return prev.map((c) => cartLineKey(c) === key ? { ...c, quantity: c.quantity + 1 } : c);
              return [...prev, newLine];
            });
          }}
        />
      )}

      {customizingKey && (() => {
        const line = cart.find((c) => cartLineKey(c) === customizingKey);
        if (!line) return null;
        return (
          <CustomiseLineDialog
            menuItemId={line.menuItem.id}
            menuItemName={line.menuItem.name}
            initialRemovedIds={line.removedIngredientIds ?? []}
            onClose={() => setCustomizingKey(null)}
            onSave={(ids, names) => {
              // Re-key the line. If another cart row now has the same
              // (menuItemId, removedIds, notes) signature, merge them
              // by summing quantity — keeps the cart tidy.
              setCart((prev) => {
                const updated = prev.map((c) => cartLineKey(c) === customizingKey ? { ...c, removedIngredientIds: ids.length > 0 ? ids : undefined, removedNames: names.length > 0 ? names : undefined } : c);
                const merged: typeof updated = [];
                for (const row of updated) {
                  const k = cartLineKey(row);
                  const existing = merged.find((m) => cartLineKey(m) === k);
                  if (existing) existing.quantity += row.quantity;
                  else merged.push(row);
                }
                return merged;
              });
              setCustomizingKey(null);
            }}
          />
        );
      })()}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OrderPage() {
  const { tableId } = useParams<{ tableId?: string }>();
  const [searchParams] = useSearchParams();
  const orderId = searchParams.get('orderId');
  const navigate = useNavigate();
  const location = useLocation();
  const tableNumber = (location.state as { tableNumber?: string })?.tableNumber ?? tableId?.slice(-4) ?? 'T/A';

  // Fetch by table (dine-in)
  const { data: tableOrders = [], isLoading: loadingTable } = useQuery<Order[]>({
    queryKey: ['orders', 'table', tableId],
    queryFn: () => api.get<Order[]>(`/orders?tableId=${tableId}`),
    enabled: !!tableId,
    staleTime: 0,
    refetchInterval: 3000,
  });

  // Fetch by id (takeaway / direct link)
  const { data: directOrder, isLoading: loadingById } = useQuery<Order>({
    queryKey: ['order', orderId],
    queryFn: () => api.get<Order>(`/orders/${orderId}`),
    enabled: !!orderId,
    staleTime: 0,
    refetchInterval: 3000,
  });

  const activeOrder = directOrder ?? tableOrders[0] ?? null;
  const goBack = () => void navigate('/tables');

  if ((tableId && loadingTable) || (orderId && loadingById)) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-theme-border font-theme-body text-sm">Loading…</span>
      </div>
    );
  }

  if (activeOrder) {
    return <ActiveOrderView order={activeOrder} onBack={goBack} />;
  }

  return <NewOrderView tableId={tableId} tableNumber={tableNumber} onBack={goBack} />;
}
