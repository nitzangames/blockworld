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

const varied = await page.evaluate(() => {
  const c = document.getElementById('c');
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  if (!gl) return { error: 'no gl context' };
  // Sample two rows: one where grass floor should be (OpenGL Y=0 is bottom, so 0.66*h from
  // bottom = upper ~66% viewport = floor when camera looks down) and one near top (sky).
  const rowFloor = new Uint8Array(4 * 64);
  const rowSky = new Uint8Array(4 * 64);
  gl.readPixels(0, Math.floor(c.height * 0.50), 64, 1, gl.RGBA, gl.UNSIGNED_BYTE, rowFloor);
  gl.readPixels(0, Math.floor(c.height * 0.85), 64, 1, gl.RGBA, gl.UNSIGNED_BYTE, rowSky);
  // Green channel of first pixel in each row
  const floorG = rowFloor[1];
  const skyG = rowSky[1];
  // Also check within the floor row for any variation (AO, block edges)
  let min = 255, max = 0;
  for (let i = 0; i < rowFloor.length; i += 4) { min = Math.min(min, rowFloor[i + 1]); max = Math.max(max, rowFloor[i + 1]); }
  return { floorG, skyG, min, max };
});

await page.screenshot({ path: 'thumbnail-raw.png' });
await browser.close();
server.kill();

if (errors.length) { console.error('PAGE ERRORS:', errors); process.exit(1); }
if (varied.error) { console.error('RENDER ERROR:', varied.error); process.exit(1); }
console.log('render sample green min/max (floor row):', { min: varied.min, max: varied.max });
console.log('floor row green:', varied.floorG, '  sky row green:', varied.skyG);
// Proof of render: floor and sky rows must differ (green channel clearly differs: grass vs sky-blue)
if (varied.floorG === varied.skyG) { console.error('canvas looks uniform — render failed (floor and sky rows identical)'); process.exit(1); }
console.log('SMOKE OK — screenshot saved to thumbnail-raw.png');
