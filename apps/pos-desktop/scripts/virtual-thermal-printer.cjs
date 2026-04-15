/**
 * Virtual thermal printer — listens on TCP :9100 and prints every byte
 * the desktop sends to stdout, with common ESC/POS commands annotated.
 *
 *   node apps/pos-desktop/scripts/virtual-thermal-printer.cjs [port]
 *
 * In Printer Settings:
 *   Mode:  Network
 *   Host:  127.0.0.1   (or this PC's LAN IP, e.g. 192.168.1.42)
 *   Port:  9100        (or whichever you pass in)
 *
 * What to look for:
 *   🔓 CASH DRAWER KICK     — ESC p  (open drawer)
 *   ✂  PAPER CUT            — GS V
 *   ●  BOLD ON / BOLD OFF   — ESC E 1 / ESC E 0
 *   ⇔  ALIGNMENT            — ESC a n
 *   ⇕  DOUBLE HEIGHT/WIDTH  — ESC ! n
 */
const net = require('net');

const PORT = Number(process.argv[2]) || 9100;

function parseEscPos(buf) {
  const out = [];
  let drawerKicks = 0;
  let paperCuts = 0;
  let i = 0;
  while (i < buf.length) {
    const b = buf[i];
    // ESC commands (0x1B)
    if (b === 0x1b && i + 1 < buf.length) {
      const cmd = buf[i + 1];
      switch (cmd) {
        case 0x40:
          out.push('\n⟦ESC @ — init⟧\n'); i += 2; continue;
        case 0x70: {
          // ESC p m t1 t2 — generalized pulse (cash drawer)
          const m = buf[i + 2], t1 = buf[i + 3], t2 = buf[i + 4];
          out.push(`\n🔓 CASH DRAWER KICK  (pin=${m}, on=${t1}ms, off=${t2}ms)\n`);
          drawerKicks++; i += 5; continue;
        }
        case 0x45: {
          const n = buf[i + 2];
          out.push(n ? '[●BOLD]' : '[○NORMAL]'); i += 3; continue;
        }
        case 0x61: {
          const n = buf[i + 2];
          const align = ['LEFT', 'CENTER', 'RIGHT'][n] ?? `?${n}`;
          out.push(`[⇔${align}]`); i += 3; continue;
        }
        case 0x21: {
          const n = buf[i + 2];
          out.push(`[⇕${n === 0 ? 'NORMAL' : 'BIG(' + n + ')'}]`); i += 3; continue;
        }
        case 0x33:
          // ESC 3 n — line spacing; skip next byte
          i += 3; continue;
        case 0x64: {
          const n = buf[i + 2];
          out.push(`[feed ${n}]`); i += 3; continue;
        }
        default:
          out.push(`[ESC 0x${cmd.toString(16)}]`);
          i += 2; continue;
      }
    }
    // GS commands (0x1D)
    if (b === 0x1d && i + 1 < buf.length) {
      const cmd = buf[i + 1];
      if (cmd === 0x56) {
        // GS V m | GS V m n  — paper cut
        const m = buf[i + 2];
        const hasN = m === 0x41 || m === 0x42 || m === 65 || m === 66;
        out.push(`\n✂  PAPER CUT (mode=${m})\n`);
        paperCuts++;
        i += hasN ? 4 : 3; continue;
      }
      out.push(`[GS 0x${cmd.toString(16)}]`);
      i += 2; continue;
    }
    // Printable ASCII
    if (b >= 0x20 && b < 0x7f) { out.push(String.fromCharCode(b)); i++; continue; }
    // Newline / CR
    if (b === 0x0a) { out.push('\n'); i++; continue; }
    if (b === 0x0d) { i++; continue; }
    // Everything else
    out.push(`[0x${b.toString(16).padStart(2, '0')}]`);
    i++;
  }
  return { text: out.join(''), drawerKicks, paperCuts };
}

const server = net.createServer((socket) => {
  const from = `${socket.remoteAddress}:${socket.remotePort}`;
  console.log(`\n━━━ connection from ${from} ━━━`);
  const chunks = [];
  socket.on('data', (d) => chunks.push(d));
  socket.on('end', () => {
    const bytes = Buffer.concat(chunks);
    const { text, drawerKicks, paperCuts } = parseEscPos(bytes);
    console.log(text);
    console.log('─'.repeat(60));
    console.log(`${bytes.length} bytes · ✂ ${paperCuts} cut${paperCuts === 1 ? '' : 's'} · 🔓 ${drawerKicks} drawer kick${drawerKicks === 1 ? '' : 's'}`);
    console.log('');
  });
  socket.on('error', (e) => console.error('socket error:', e.message));
});

server.listen(PORT, () => {
  console.log(`Virtual thermal printer listening on :${PORT}`);
  console.log('Point the desktop app here and click Test Print.\n');
});
