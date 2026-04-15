# Cashier PC Setup — Silent Kitchen Printing

Use this guide when a branch runs **without a KDS screen** (Admin → Settings → Kitchen → Use KDS = Off). In that mode, every order fired from the POS auto-opens a 80mm kitchen ticket and prints it. This doc explains how to set up the cashier PC so the print fires silently (no dialog).

## 1. Connect the kitchen thermal printer to the cashier PC

Options:

- **Network thermal printer** (Epson TM-T82, Star TSP143, Bixolon, Rongta, etc.)
  - Plug it into the same network as the cashier PC.
  - Note the printer's IP address (the printer usually prints a self-test with its IP on power-on).
  - On Windows: Settings → Bluetooth & devices → Printers & scanners → Add device → "The printer that I want isn't listed" → Add a printer using a TCP/IP address → enter the IP, select "Generic / Text Only" driver (or the vendor driver if shipped).
- **USB thermal printer**
  - Plug in → install the driver from the vendor (or "Generic / Text Only" for raw ESC/POS).

## 2. Set it as the Windows default printer

Windows 11: Settings → Bluetooth & devices → Printers & scanners → pick the kitchen printer → "Set as default".

> Make sure **"Let Windows manage my default printer"** is **off** — otherwise Windows rotates the default based on usage.

## 3. Launch Chrome in kiosk-printing mode

Create a desktop shortcut that points at your POS URL with the `--kiosk-printing` flag. This tells Chrome to skip the print dialog and print straight to the default printer.

Right-click on the desktop → New → Shortcut → enter:

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing --app=https://pos.your-domain.com
```

- Replace the URL with your actual POS URL.
- `--app=...` opens Chrome in app-window mode (no tabs, no address bar).
- `--kiosk-printing` bypasses the print dialog — `window.print()` silently sends the job to the default printer.

Double-click the shortcut. Sign in. Place a test order. The kitchen ticket should slide out of the thermal printer without any dialog popping up.

## 4. Allow pop-ups for the POS site

Chrome blocks `window.open()` if pop-ups are blocked. In Chrome:

- Click the ⋮ menu → Settings → Privacy and security → Site Settings → Pop-ups and redirects → add your POS URL to "Allowed to send pop-ups".

## 5. Verify

1. Fire a test order in POS.
2. Within 1-2 seconds you should see a small window flash and immediately close.
3. The kitchen thermal printer spits out the ticket.
4. No clicks required.

If the ticket doesn't print:
- Check the Windows default printer is still set to the kitchen thermal.
- Check the printer isn't out of paper / offline.
- Check pop-ups are allowed for the POS URL.
- Check Chrome was launched with `--kiosk-printing` (you can verify via chrome://version → "Command Line").

## Troubleshooting: print dialog still appears

- The `--kiosk-printing` flag only works when Chrome was launched with it from that shortcut. Opening a new Chrome tab/window manually won't inherit the flag.
- Some antivirus / enterprise policies strip command-line flags. Check group policy if you're on a managed Windows.

## What this does NOT give you

- **No cash drawer kick.** Opening the cash drawer requires sending a specific ESC/POS byte sequence directly to the printer, which the browser can't do. For cash drawer support we'll need the Local Print Bridge agent (separate project).
- **No silent printing from mobile Chrome.** The kiosk flag is desktop-only.
