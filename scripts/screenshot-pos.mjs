import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.resolve(__dirname, '../temporary screenshots');
const POS_URL = 'http://localhost:5173';

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: { width: 1440, height: 900 },
    args: ['--no-sandbox'],
  });

  const page = await browser.newPage();

  // Login
  console.log('📸 POS Login...');
  await page.goto(POS_URL, { waitUntil: 'networkidle2', timeout: 15000 });
  try {
    await page.waitForSelector('input[type="email"]', { timeout: 5000 });
    await page.type('input[type="email"]', 'cashier@restora.app');
    await page.type('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await new Promise(r => setTimeout(r, 3000));
  } catch (e) {
    console.log('  Already logged in');
  }

  // Tables
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'pos-01-tables.png') });
  console.log('  ✅ Tables');

  // Click an available table (T02)
  try {
    const tables = await page.$$('button');
    for (const btn of tables) {
      const text = await btn.evaluate(el => el.textContent);
      if (text && text.includes('T02') && text.includes('AVAILABLE')) {
        await btn.click();
        break;
      }
    }
    await new Promise(r => setTimeout(r, 2000));
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'pos-02-new-order.png') });
    console.log('  ✅ New Order (menu + cart)');
  } catch (e) {
    console.log('  ⚠️ Could not click table:', e.message);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'pos-02-new-order.png') });
  }

  // Click an occupied table (T04) to see active order
  await page.goto(POS_URL, { waitUntil: 'networkidle2', timeout: 10000 });
  await new Promise(r => setTimeout(r, 2000));
  try {
    const tables2 = await page.$$('button');
    for (const btn of tables2) {
      const text = await btn.evaluate(el => el.textContent);
      if (text && text.includes('T04') && text.includes('OCCUPIED')) {
        await btn.click();
        break;
      }
    }
    await new Promise(r => setTimeout(r, 2000));
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'pos-03-active-order.png') });
    console.log('  ✅ Active Order');
  } catch (e) {
    console.log('  ⚠️ No occupied table found');
  }

  await browser.close();
  console.log('\n🎉 POS screenshots saved!');
}

main().catch(console.error);
