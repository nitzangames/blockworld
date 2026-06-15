import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const server = spawn('node', ['scripts/dev-server.mjs'], { stdio: 'inherit' });
await new Promise((r) => setTimeout(r, 800));

const browser = await puppeteer.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://localhost:8093', { waitUntil: 'domcontentloaded' });
await new Promise((r) => setTimeout(r, 2500)); // let scripts load + a few frames render

// The game now boots to a main menu when no PlaySDK is present (headless smoke env).
// We verify the menu rendered and no page errors occurred, rather than sampling 3D pixels
// (no world renders without PlaySDK — clicking "host" would throw since sdk is undefined).
const menuPresent = await page.evaluate(() => !!document.getElementById('mainmenu'));

await page.screenshot({ path: 'thumbnail-raw.png' });
await browser.close();
server.kill();

if (errors.length) { console.error('PAGE ERRORS:', errors); process.exit(1); }
if (!menuPresent) { console.error('SMOKE FAIL — #mainmenu not found; boot did not show the main menu'); process.exit(1); }
console.log('SMOKE OK — main menu rendered, no page errors; screenshot saved to thumbnail-raw.png');
