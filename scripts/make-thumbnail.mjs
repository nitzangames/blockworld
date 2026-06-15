// Renders the real 3D voxel engine to a 512x512 thumbnail.png (with the title baked in).
// Captures via canvas.toDataURL (page screenshots of a swiftshader WebGL canvas come out black).
// Uses the running dev server on :8093 if present, otherwise starts one.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer';

let server = null;
try { server = spawn('node', ['scripts/dev-server.mjs'], { stdio: 'ignore' }); } catch {}
await new Promise((r) => setTimeout(r, 800));

const browser = await puppeteer.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 512, height: 512, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://localhost:8093/scripts/thumb.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__ready === true', { timeout: 8000 });
const dataUrl = await page.evaluate(() => window.__thumbDataURL);
await browser.close();
if (server) server.kill();

if (errors.length) { console.error('PAGE ERRORS:', errors); process.exit(1); }
if (!dataUrl || !dataUrl.startsWith('data:image/png')) { console.error('no thumbnail data'); process.exit(1); }
writeFileSync('thumbnail.png', Buffer.from(dataUrl.split(',')[1], 'base64'));
console.log('thumbnail.png written (512x512)');
