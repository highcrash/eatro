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
      //    from the order's current table, transfer the order. We
      //    only do this for orders the logged-in customer owns
      //    (server gates on customerId match too).
      if (activeOrderId && customer && activeOrderTableId && activeOrderTableId !== table.id) {
        try {
          await fetch(apiUrl(`/orders/qr/${activeOrderId}/move-table`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-branch-id': table.branchId },
            body: JSON.stringify({ tableId: table.id, customerId: customer.id }),
          });
        } catch { /* server failure shouldn't block the customer from seeing their order */ }
      } else if (activeOrderId && previousTableId && previousTableId !== table.id && customer) {
        // Edge case: server didn't return the order (transient) but we
        // know the local session jumped tables AND there's a logged-in
        // customer. Try to move anyway — server will no-op the same-
        // table case.
        try {
          await fetch(apiUrl(`/orders/qr/${activeOrderId}/move-table`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-branch-id': table.branchId },
            body: JSON.stringify({ tableId: table.id, customerId: customer.id }),
          });
        } catch { /* same as above — non-fatal */ }
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
