import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const url = process.argv[2] || 'http://localhost:3000';
const dir = path.join(__dirname, 'temporary screenshots');

if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outFile = path.join(dir, `screenshot-${ts}.png`);

try {
  // Try puppeteer
  const { default: puppeteer } = await import('puppeteer');
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  console.log(`Navigating to ${url}...`);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000)); // let animations settle
  await page.screenshot({ path: outFile, fullPage: false });
  await browser.close();
  console.log(`Screenshot saved: ${outFile}`);
} catch (e) {
  if (e.code === 'ERR_MODULE_NOT_FOUND' || e.message?.includes('Cannot find')) {
    console.log('puppeteer not installed. Install with: npm install puppeteer');
    console.log('Or open the browser manually at:', url);
  } else {
    console.error('Screenshot failed:', e.message);
  }
}
