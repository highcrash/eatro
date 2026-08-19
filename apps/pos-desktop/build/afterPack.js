// Embeds the app icon + version-info metadata into the packaged Windows exe.
//
// electron-builder's built-in icon/version-info step (win.signAndEditExecutable)
// shells out to a copy of rcedit bundled inside the "winCodeSign" vendor
// archive, which also contains macOS codesign tooling (symlinks). Extracting
// that archive requires the "Create symbolic links" Windows privilege, which
// isn't available to every account (locked-down/managed machines included) —
// see electron-builder.yml, where signAndEditExecutable is turned off.
//
// The standalone `rcedit` npm package wraps the same Microsoft rcedit.exe
// with no macOS payload, so it needs no special privilege. Running it here
// reproduces exactly what the built-in step would have done.
const path = require('path');

module.exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  const { rcedit } = await import('rcedit');
  const { appInfo } = context.packager;
  const exePath = path.join(context.appOutDir, `${appInfo.productFilename}.exe`);
  const copyright = context.packager.config.copyright;
  // Derive the company name from "Copyright © <year> <Company>" rather than
  // hardcoding a brand string — keeps this hook correct on both the
  // "Restora"-branded main branch and the white-labeled codecanyon branch
  // without needing per-branch edits.
  const companyName = copyright?.replace(/^Copyright ©\s*\d{4}\s*/, '') || appInfo.productName;

  await rcedit(exePath, {
    icon: path.join(__dirname, 'icon.ico'),
    'file-version': appInfo.buildVersion,
    'product-version': appInfo.version,
    'version-string': {
      ProductName: appInfo.productName,
      FileDescription: appInfo.productName,
      CompanyName: companyName,
      LegalCopyright: copyright,
    },
  });
};
