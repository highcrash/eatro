import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSessionStore } from '../store/session.store';
import { apiUrl } from '../lib/api';

interface TableInfo {
  id: string;
  branchId: string;
  branchName: string;
  tableNumber: string;
}

interface ActiveOrderResponse {
  order: { id: string; orderNumber: string; tableId: string | null; tableNumber: string | null; status: string } | null;
}

/**
 * Landing page for `/table/:tableId` (QR scan entry point). Three jobs
 * after the table-info fetch:
 *
 *   1. Update the session — branch + table.
 *   2. **If a logged-in customer has an active order in this branch**,
 *      pull the order from the server and rehydrate `activeOrderId`
 *      into the local session. Without this, a refresh / re-scan of
 *      a tab that lost its in-memory state would silently drop the
 *      live order's link — admin would have to re-identify the
 *      customer to find it again.
 *   3. **If the customer rescans a *different* table while their order
 *      is still open**, transfer the order to the new table via the
 *      public `POST /orders/qr/:id/move-table` endpoint. The POS
 *      picks up the move via the existing `order:updated` /
 *      `table:updated` WS events.
 *
 * After all of that, we navigate to:
 *   - `/order/:id` if there's an active order to view, or
 *   - `/menu` for a fresh QR scan with no prior order.
 */
export default function TableEntry() {
  const { tableId } = useParams<{ tableId: string }>();
  const navigate = useNavigate();
  const setSession = useSessionStore((s) => s.setSession);
  const setActiveOrder = useSessionStore((s) => s.setActiveOrder);

  useEffect(() => {
    if (!tableId) return;
    let cancelled = false;
    (async () => {
      // 1. Resolve table → branch.
      let table: TableInfo;
      try {
        const res = await fetch(apiUrl(`/public/table/${tableId}`));
        if (!res.ok) throw new Error('Table lookup failed');
        table = (await res.json()) as TableInfo;
      } catch {
        if (!cancelled) void navigate('/menu', { replace: true });
        return;
      }
      if (cancelled) return;

      const prev = useSessionStore.getState();
      const customer = prev.customer;
      const previousTableId = prev.tableId;

      // 2. Try to rehydrate active order. The lookup is keyed on
      //    customer + branch (not table) — so a logged-in customer
      //    moving from Table 4 to Table 7 still finds their order.
      let activeOrderId: string | null = null;
      let activeOrderTableId: string | null = null;
      if (customer) {
        try {
          const res = await fetch(apiUrl('/customers/auth/active-order'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-branch-id': table.branchId },
            body: JSON.stringify({ customerId: customer.id }),
          });
          if (res.ok) {
            const data = (await res.json()) as ActiveOrderResponse;
            if (data.order) {
              activeOrderId = data.order.id;
              activeOrderTableId = data.order.tableId;
            }
          }
        } catch { /* network blip — fall through; user keeps any in-memory active order */ }
      }
      // Fall back to the locally-persisted activeOrderId if the server
      // didn't return one (e.g. anonymous-cart device).
      if (!activeOrderId) activeOrderId = prev.activeOrderId;

      // Cross-device rescan: another diner already at this table has an
      // open order. The customer-keyed lookup above only finds orders
      // that belong to *this* device's logged-in customer; if a guest
      // (or a different customer) scans the same table, we still want
      // to land them on the running order so they can add/remove items
      // or request the bill. Skip when we already have one matched
      // upstream, and skip when the server returns a different
      // customer's order while THIS device IS logged in (avoid hijacking
      // someone else's session).
      if (!activeOrderId) {
        try {
          const res = await fetch(apiUrl(`/orders/qr/by-table/${table.id}`), {
            headers: { 'x-branch-id': table.branchId },
          });
          if (res.ok) {
            const tableOrder = (await res.json()) as { id: string; customerId: string | null } | null;
            if (tableOrder) {
              // If THIS device is logged-in but the table's active order
              // belongs to a different customer, stay anonymous on the
              // running order: don't try to claim it as the logged-in
              // customer's. Customer-id mismatch is OK — the server's
              // order endpoints accept anonymous edits while the order
              // is still PENDING.
              activeOrderId = tableOrder.id;
              activeOrderTableId = table.id;
            }
          }
        } catch { /* network blip — no fallback */ }
      }

      // 3. Update session. Preserve customer; bump tableId to whatever
      //    was just scanned. The session store's setSession spreads
      //    these onto the existing state without touching customer.
      setSession({
        tableId: table.id,
        branchId: table.branchId,
        branchName: table.branchName,
        tableNumber: table.tableNumber,
      });

      // 4. If there's an active order AND the scanned table differs
      //    from the order's current table, try to transfer the order.
      //    Server gates this on customerId match AND destination-table
      //    availability (409 when another diner's order is already
      //    sitting there). On 409 we soft-fail — keep the customer on
      //    their EXISTING table rather than clobber the occupant.
      const tryMove = async (orderId: string): Promise<{ moved: boolean; tableConflict: boolean; conflictMsg?: string }> => {
        try {
          const res = await fetch(apiUrl(`/orders/qr/${orderId}/move-table`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-branch-id': table.branchId },
            body: JSON.stringify({ tableId: table.id, customerId: customer!.id }),
          });
          if (res.status === 409) {
            const body = await res.json().catch(() => null) as { message?: string } | null;
            return { moved: false, tableConflict: true, conflictMsg: body?.message };
          }
          return { moved: res.ok, tableConflict: false };
        } catch {
          return { moved: false, tableConflict: false };
        }
      };

      let tableConflict = false;
      let conflictMsg: string | undefined;
      if (activeOrderId && customer && activeOrderTableId && activeOrderTableId !== table.id) {
        const r = await tryMove(activeOrderId);
        tableConflict = r.tableConflict;
        conflictMsg = r.conflictMsg;
      } else if (activeOrderId && previousTableId && previousTableId !== table.id && customer) {
        // Edge case: server didn't return the order (transient) but we
        // know the local session jumped tables AND there's a logged-in
        // customer. Try to move anyway — server will no-op the same-
        // table case.
        const r = await tryMove(activeOrderId);
        tableConflict = r.tableConflict;
        conflictMsg = r.conflictMsg;
      }

      // If the move was refused because the new table is occupied,
      // bounce the session BACK to the customer's original tableId so
      // they don't see "Table 4" in the header while their order is
      // still actually on Table 7. Setting session twice in a row is
      // fine — second call wins.
      if (tableConflict && activeOrderTableId) {
        // Re-query the (now-known) original table to keep tableNumber
        // accurate on the header.
        try {
          const res = await fetch(apiUrl(`/public/table/${activeOrderTableId}`));
          if (res.ok) {
            const t = (await res.json()) as TableInfo;
            setSession({
              tableId: t.id,
              branchId: t.branchId,
              branchName: t.branchName,
              tableNumber: t.tableNumber,
            });
          }
        } catch { /* if this lookup fails, the wrong tableNumber is shown but the order is still correct */ }
        // Surface the reason to the customer on the next page.
        if (conflictMsg) sessionStorage.setItem('qr-toast', conflictMsg);
      }

      setActiveOrder(activeOrderId);

      if (cancelled) return;
      // 5. Route the customer.
      if (activeOrderId) {
        void navigate(`/order/${activeOrderId}`, { replace: true });
      } else {
        void navigate('/menu', { replace: true });
      }
    })();
    return () => { cancelled = true; };
  }, [tableId, navigate, setSession, setActiveOrder]);

  return (
    <div className="flex items-center justify-center h-screen bg-[#0D0D0D]">
      <div className="text-center">
        <div className="w-16 h-16 bg-[#C8FF00] flex items-center justify-center mx-auto mb-4 animate-pulse">
          <span className="font-display text-[#0D0D0D] text-3xl">R</span>
        </div>
        <p className="text-sm text-[#666] font-body">Loading menu...</p>
      </div>
    </div>
  );
}
