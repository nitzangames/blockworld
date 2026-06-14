import { createWorld, fillFloor, getBlock } from './lib/voxel/store.js';
import { createWorldView, isMobile } from './lib/render/world-view.js';
import { createFlyCamera, updateFlyCamera, lookDir } from './lib/player/fly-camera.js';
import { raycast } from './lib/voxel/raycast.js';
import { applyEdit } from './lib/voxel/edit.js';
import { createDesktopInput } from './lib/input/desktop.js';
import { createMobileInput } from './lib/input/mobile.js';
import { createHUD } from './lib/ui/hud.js';
import { loadCurrent, saveCurrent, makeAutosaver } from './lib/persist/world-store.js';
import { WX, WZ } from './lib/constants.js';

const REACH = 8;
let selected = 1;
const canvas = document.getElementById('c');

async function boot() {
  const sdk = window.PlaySDK;
  let world = null;
  if (sdk && sdk.load) { try { world = await loadCurrent(sdk); } catch {} }
  if (!world) { world = createWorld(); fillFloor(world, 8); }

  const view = createWorldView(canvas, world);
  view.rebuildAll();
  const cam = createFlyCamera([WX / 2, 18, WZ / 2], 0, -0.5);

  const autosave = sdk && sdk.save ? makeAutosaver(sdk, () => world, 3000) : () => {};

  function doEdit(place) {
    const dir = lookDir(cam);
    const hit = raycast(world, cam.pos, dir, REACH);
    if (!hit) return;
    let x = hit.cell[0], y = hit.cell[1], z = hit.cell[2], block = 0;
    if (place) { x += hit.normal[0]; y += hit.normal[1]; z += hit.normal[2]; block = selected; }
    const res = applyEdit(world, x, y, z, block);
    if (res.ok) { res.dirty.forEach((id) => view.rebuildChunk(id)); autosave(); }
  }

  const hud = createHUD({ onPick: (i) => { selected = i; hud.refresh(); }, getSelected: () => selected });

  const desktop = createDesktopInput(canvas, {
    onPlace: () => doEdit(true), onBreak: () => doEdit(false),
    onPick: (i) => { if (i <= 16) { selected = i; hud.refresh(); } },
    onMenu: () => {},
  });
  const mobile = isMobile()
    ? createMobileInput(document.getElementById('touchUI'), { onPlace: () => doEdit(true), onBreak: () => doEdit(false) })
    : null;

  let running = true;
  if (sdk && sdk.onPause) sdk.onPause(() => { running = false; });
  if (sdk && sdk.onResume) sdk.onResume(() => { if (!running) { running = true; last = performance.now(); loop(last); } });
  window.addEventListener('beforeunload', () => { if (sdk && sdk.save) saveCurrent(sdk, world); });

  let last = performance.now();
  function loop(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const intent = mobile ? mobile.pollIntent() : desktop.pollIntent();
    updateFlyCamera(cam, intent, dt);
    view.render(cam);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

if (window.PlaySDK && window.PlaySDK.onReady) window.PlaySDK.onReady(boot); else boot();
