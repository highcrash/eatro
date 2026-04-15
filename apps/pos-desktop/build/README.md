# build/

electron-builder's "build resources" directory.

## What belongs here

- **`icon.ico`** — the Windows installer & app icon. Recommended: a 256x256
  multi-resolution .ico (include 16, 24, 32, 48, 64, 128, 256 sizes). Can also
  supply `icon.png` and let electron-builder convert.

Until you drop an icon here, the desktop ships with the default Electron icon.
Replace before cutting the first real release.

## Other files electron-builder may pick up automatically

- `installer.nsh` — optional NSIS customizations.
- `installerHeader.bmp`, `installerSidebar.bmp` — banner graphics for the
  NSIS wizard (493x58 and 164x314 BMPs respectively, for the classic style).

All optional. None required for a working build.
