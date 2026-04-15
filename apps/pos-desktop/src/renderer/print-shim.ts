/**
 * Monkey-patches `window.open` so the POS's popup-based print flows land on
 * the desktop's configured thermal / A4 printers instead of a browser print
 * dialog.
 *
 * How it works:
 *   - When the POS calls `window.open('', '_blank', 'width=320,...')` it's
 *     setting up a popup it intends to draw into + auto-print.
 *   - We return a fake window whose document.write() accumulates HTML.
 *   - When the fake window's inline <script>window.print()</script> fires,
 *     we intercept it, sniff the HTML to pick a slot, and route through
 *     `window.desktop.print.*`.
 *   - Any real window.open call (auth redirects, documentation links, etc.)
 *     falls through to the native implementation untouched.
 */
const realOpen = window.open.bind(window);

type Slot = 'kitchen' | 'bill' | 'reports';

function sniffSlot(html: string, widthHint: number | null): Slot {
  const h = html.toUpperCase();
  if (h.includes('KITCHEN ORDER') || h.includes('ADDITIONAL ITEMS')) return 'kitchen';
  // 80 mm-ish popups without a kitchen keyword are almost always receipts.
  if (widthHint != null && widthHint <= 400) return 'bill';
  return 'reports';
}

function parseWidth(features: string | undefined): number | null {
  if (!features) return null;
  const m = features.match(/width\s*=\s*(\d+)/i);
  return m ? Number(m[1]) : null;
}

interface FakeDocument {
  write(html: string): void;
  close(): void;
  // Minimal props some POS code may probe.
  body: null;
}

interface FakeWindow {
  document: FakeDocument;
  print: () => void;
  close: () => void;
  closed: boolean;
  onload: (() => void) | null;
}

function routeHtmlToDesktop(html: string, slot: Slot): void {
  const api = window.desktop?.print;
  if (!api) {
    console.warn('[print-shim] window.desktop.print unavailable; dropping print');
    return;
  }

  if (slot === 'reports') {
    void api.reportA4({ html });
    return;
  }

  // Thermal slots need a structured payload. Since this HTML is the
  // browser-native rendering (popup), we don't have structured data here —
  // we route it to the bill/kitchen printer via the same os-printer /
  // network path by calling reportA4 with a narrow page size. The
  // desktop's html-print already handles width overrides.
  //
  // Simpler + works: fall through to reportA4 for os-printer setups. For
  // network ESC/POS setups, this path won't hit the thermal properly —
  // users should prefer the modal-based flow (ReceiptModal / KDS) which
  // already ships structured data. Surface a dev-only warning.
  if (slot === 'bill') {
    console.warn('[print-shim] Legacy popup-based bill print — prefer ReceiptModal for ESC/POS quality.');
  } else if (slot === 'kitchen') {
    console.warn('[print-shim] Legacy popup-based kitchen print — printKitchenTicket util now routes through IPC.');
  }
  void api.reportA4({ html });
}

export function installPrintShim(): void {
  if (!window.desktop) return; // not running in Electron

  window.open = function patchedOpen(
    url?: string | URL,
    target?: string,
    features?: string,
  ): Window | null {
    const intendedForPrint =
      (url === '' || url == null) &&
      (target === '_blank' || target == null) &&
      !!features;

    if (!intendedForPrint) {
      return realOpen(url ?? undefined, target ?? undefined, features ?? undefined);
    }

    const widthHint = parseWidth(features);
    let buffer = '';
    let printed = false;

    const fake: FakeWindow = {
      document: {
        body: null,
        write(html: string) { buffer += html; },
        close() { /* no-op */ },
      },
      print() {
        if (printed) return;
        printed = true;
        const slot = sniffSlot(buffer, widthHint);
        routeHtmlToDesktop(buffer, slot);
      },
      close() { fake.closed = true; },
      closed: false,
      onload: null,
    };

    return fake as unknown as Window;
  } as typeof window.open;
}
