import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.resolve(__dirname, '../temporary screenshots');

const ADMIN_URL = 'http://localhost:5174';
const POS_URL = 'http://localhost:5173';

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: { width: 1440, height: 900 },
    args: ['--no-sandbox'],
  });

  // ── Admin Login ──────────────────────────────────────────────────────────
  console.log('📸 Logging into Admin...');
  const adminPage = await browser.newPage();
  await adminPage.goto(ADMIN_URL, { waitUntil: 'networkidle2', timeout: 15000 });
  await adminPage.screenshot({ path: path.join(SCREENSHOT_DIR, '01-admin-login.png') });

  // Login
  try {
    await adminPage.waitForSelector('input[type="email"]', { timeout: 5000 });
    await adminPage.type('input[type="email"]', 'owner@restora.app');
    await adminPage.type('input[type="password"]', 'password123');
    await adminPage.click('button[type="submit"]');
    await adminPage.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));
  } catch (e) {
    console.log('  Already logged in or login failed, continuing...');
  }

  // Admin Dashboard
  await adminPage.goto(`${ADMIN_URL}/`, { waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 1500));
  await adminPage.screenshot({ path: path.join(SCREENSHOT_DIR, '02-admin-dashboard.png') });
  console.log('  ✅ Dashboard');

  // Admin Menu
  await adminPage.goto(`${ADMIN_URL}/menu`, { waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 1500));
  await adminPage.screenshot({ path: path.join(SCREENSHOT_DIR, '03-admin-menu.png') });
  console.log('  ✅ Menu');

  // Admin Inventory
  await adminPage.goto(`${ADMIN_URL}/inventory`, { waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 1500));
  await adminPage.screenshot({ path: path.join(SCREENSHOT_DIR, '04-admin-inventory.png') });
  console.log('  ✅ Inventory');

  // Admin Orders
  await adminPage.goto(`${ADMIN_URL}/orders`, { waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 1500));
  await adminPage.screenshot({ path: path.join(SCREENSHOT_DIR, '05-admin-orders.png') });
  console.log('  ✅ Orders');

  // Admin Suppliers
  await adminPage.goto(`${ADMIN_URL}/suppliers`, { waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 1500));
  await adminPage.screenshot({ path: path.join(SCREENSHOT_DIR, '06-admin-suppliers.png') });
  console.log('  ✅ Suppliers');

  // Admin Expenses
  await adminPage.goto(`${ADMIN_URL}/expenses`, { waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 1500));
  await adminPage.screenshot({ path: path.join(SCREENSHOT_DIR, '07-admin-expenses.png') });
  console.log('  ✅ Expenses');

  // Admin Accounts P&L
  await adminPage.goto(`${ADMIN_URL}/accounts`, { waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 1500));
  await adminPage.screenshot({ path: path.join(SCREENSHOT_DIR, '08-admin-accounts.png') });
  console.log('  ✅ Accounts');

  // Admin Reports
  await adminPage.goto(`${ADMIN_URL}/reports`, { waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 1500));
  await adminPage.screenshot({ path: path.join(SCREENSHOT_DIR, '09-admin-reports.png') });
  console.log('  ✅ Reports');

  // Admin Staff
  await adminPage.goto(`${ADMIN_URL}/staff`, { waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 1500));
  await adminPage.screenshot({ path: path.join(SCREENSHOT_DIR, '10-admin-staff.png') });
  console.log('  ✅ Staff');

  // Admin Recipes
  await adminPage.goto(`${ADMIN_URL}/recipes`, { waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 1500));
  await adminPage.screenshot({ path: path.join(SCREENSHOT_DIR, '11-admin-recipes.png') });
  console.log('  ✅ Recipes');

  // Admin Pre-Ready
  await adminPage.goto(`${ADMIN_URL}/pre-ready`, { waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 1500));
  await adminPage.screenshot({ path: path.join(SCREENSHOT_DIR, '12-admin-preready.png') });
  console.log('  ✅ Pre-Ready Foods');

  // ── POS Login ────────────────────────────────────────────────────────────
  console.log('\n📸 Logging into POS...');
  const posPage = await browser.newPage();
  await posPage.goto(POS_URL, { waitUntil: 'networkidle2', timeout: 15000 });
  await posPage.screenshot({ path: path.join(SCREENSHOT_DIR, '13-pos-login.png') });

  try {
    await posPage.waitForSelector('input[type="email"]', { timeout: 5000 });
    await posPage.type('input[type="email"]', 'cashier@restora.app');
    await posPage.type('input[type="password"]', 'password123');
    await posPage.click('button[type="submit"]');
    await posPage.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));
  } catch (e) {
    console.log('  Already logged in or login failed, continuing...');
  }

  // POS Tables
  await posPage.screenshot({ path: path.join(SCREENSHOT_DIR, '14-pos-tables.png') });
  console.log('  ✅ Tables');

  await adminPage.close();
  await posPage.close();
  await browser.close();
  console.log('\n🎉 All screenshots saved to "temporary screenshots/"');
}

main().catch(console.error);
