import { createWorld, fillFloor } from './lib/voxel/store.js';
import { createWorldView, isMobile } from './lib/render/world-view.js';
import { createFlyCamera, updateFlyCamera, lookDir } from './lib/player/fly-camera.js';
import { raycast } from './lib/voxel/raycast.js';
import { createDesktopInput } from './lib/input/desktop.js';
import { createMobileInput } from './lib/input/mobile.js';
import { createHUD } from './lib/ui/hud.js';
import { getWorlds, loadWorld, saveWorld, saveIndex, newWorldId, upsertWorld, renameInIndex, deleteWorld, makeWorldAutosaver } from './lib/persist/worlds.js';
import { WX, WZ } from './lib/constants.js';
import { createSession } from './lib/net/session.js';
import { makePlayTransport } from './lib/net/play-transport.js';
import { createAvatars } from './lib/render/avatars.js';
import { showMainMenu, createInWorldMenu } from './lib/ui/menus.js';

const REACH = 8;
let selected = 1;
const canvas = document.getElementById('c');

function showNotice(text) {
  const n = document.createElement('div');
  n.textContent = text;
  n.style.cssText = 'position:absolute;left:50%;top:18px;transform:translateX(-50%);z-index:30;background:rgba(20,23,28,.95);color:#fff;padding:10px 16px;border-radius:10px;font-family:system-ui,sans-serif;font-size:14px;pointer-events:none';
  document.body.appendChild(n);
  setTimeout(() => n.remove(), 4000);
}

function showLoading(text) {
  const o = document.createElement('div');
  o.style.cssText = 'position:absolute;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;background:rgba(15,17,21,.85);color:#fff;font-family:system-ui,sans-serif;font-size:18px;pointer-events:auto';
  o.textContent = text;
  document.body.appendChild(o);
  return o;
}

function defaultWorldName(index) {
  const names = new Set((index || []).map((w) => w.name));
  let n = (index ? index.length : 0) + 1;
  while (names.has('World ' + n)) n++;
  return 'World ' + n;
}

async function boot() {
  const sdk = window.PlaySDK;
  const displayName = sdk && sdk.getDisplayName ? await sdk.getDisplayName().catch(() => null) : null;
  let index = sdk && sdk.load ? await getWorlds(sdk, Date.now()).catch(() => []) : [];

  async function saveIndexSafe() { try { if (sdk && sdk.save) await saveIndex(sdk, index); } catch {} }

  const menu = showMainMenu({
    worlds: index,
    displayName,
    defaultName: defaultWorldName(index),
    onListRooms: () => (sdk && sdk.multiplayer && sdk.multiplayer.listRooms ? sdk.multiplayer.listRooms() : Promise.resolve([])),
    onOpen: (id) => startHost(id),
    onNew: async (name) => {
      const id = newWorldId(index);
      const w = createWorld(); fillFloor(w, 8);
      if (sdk && sdk.save) { await saveWorld(sdk, id, w); upsertWorld(index, { id, name, updatedAt: Date.now() }); await saveIndexSafe(); }
      startHost(id, w, name);
    },
    onRename: async (id, name) => { renameInIndex(index, id, name); await saveIndexSafe(); menu.setWorlds(index); },
    onDelete: async (id) => { index = sdk && sdk.save ? await deleteWorld(sdk, index, id) : index.filter((x) => x.id !== id); menu.setWorlds(index); },
    onJoin: (code) => startVisitor(code),
  });

  async function startHost(worldId, preworld, nameHint) {
    let room;
    try { room = await sdk.multiplayer.createRoom({ maxPlayers: 8, visibility: 'public' }); }
    catch (e) { menu.setStatus('Could not host: ' + (e && e.message ? e.message : 'try again')); return; }
    const transport = makePlayTransport(sdk, room, room.hostId);
    const entry = index && worldId ? index.find((w) => w.id === worldId) : null;
    const worldName = nameHint || (entry && entry.name) || 'World';
    menu.close();
    runGame({ sdk, room, transport, ownerId: room.hostId, host: true, myName: displayName || 'Guest', worldId, preworld, index, worldName });
  }
  async function startVisitor(code) {
    let room;
    try { room = await sdk.multiplayer.joinRoom(code); }
    catch (e) { menu.setStatus('Join failed: ' + (e && e.message ? e.message : 'check the code')); return; }
    const transport = makePlayTransport(sdk, room, room.hostId);
    menu.close();
    runGame({ sdk, room, transport, ownerId: room.hostId, host: false, myName: displayName || 'Guest' });
  }
}

function runGame({ sdk, room, transport, ownerId, host, myName, worldId, preworld, index, worldName }) {
  let world = preworld || createWorld();
  const view = createWorldView(canvas, world);
  const avatars = createAvatars(view.scene);
  const cam = createFlyCamera([WX / 2, 4, WZ / 2], 0, -0.35);
  const clientId = 'c' + Math.floor(Math.random() * 1e9);
  let loadingEl = host ? null : showLoading('Loading world…');
  const autosave = host && worldId && sdk && sdk.save
    ? makeWorldAutosaver(sdk, worldId, () => world, index, () => Date.now(), 3000)
    : () => {};

  function rebindWorld() { view.setWorld(world); view.rebuildAll(); }

  const session = createSession({
    transport, ownerId, myName, clientId, getWorld: () => world,
    hooks: {
      worldName: worldName || 'World',
      onWelcome: () => inWorld.refresh(),
      onSnapshot: (w) => { world = w; rebindWorld(); if (loadingEl) { loadingEl.remove(); loadingEl = null; } },
      applyRemoteEdit: (x, y, z, b, dirty) => { dirty.forEach((id) => view.rebuildChunk(id)); if (host) autosave(); },
      onPos: (userId, p) => avatars.setTarget(userId, p.n || 'Player', p),
      onPlayerLeft: (userId) => avatars.remove(userId),
      onPlayers: () => inWorld.refresh(),
      onPermChange: () => {},
      onEnded: () => {},
    },
  });

  if (host) {
    if (preworld) { world = preworld; rebindWorld(); }
    else if (sdk && sdk.load && worldId) {
      loadWorld(sdk, worldId).then((w) => { if (w) world = w; else { world = createWorld(); fillFloor(world, 8); } rebindWorld(); }).catch(() => { world = createWorld(); fillFloor(world, 8); rebindWorld(); });
    } else { world = createWorld(); fillFloor(world, 8); rebindWorld(); }
  }

  function act() {
    if (!session.canEditLocal()) return;
    const hit = raycast(world, cam.pos, lookDir(cam), REACH);
    if (!hit) return;
    let x, y, z, b;
    if (selected === 0) { [x, y, z] = hit.cell; b = 0; }
    else { x = hit.cell[0] + hit.normal[0]; y = hit.cell[1] + hit.normal[1]; z = hit.cell[2] + hit.normal[2]; b = selected; }
    session.requestEdit(x, y, z, b);
  }

  const hud = createHUD({ onPick: (i) => { selected = i; hud.refresh(); }, getSelected: () => selected });
  const inWorld = createInWorldMenu({
    getState: () => ({ isHost: host, code: room.code, worldName: session.worldName(), players: session.players() }),
    onToggle: (userId, canEdit) => session.setPermission(userId, canEdit),
    onLeave: () => { try { room.leave(); } catch (e) {} location.reload(); },
  });
  document.getElementById('menuBtn').addEventListener('click', () => inWorld.toggle());

  const desktop = createDesktopInput(canvas, {
    onAct: act,
    onPick: (i) => { if (i >= 0 && i <= 16) { selected = i; hud.refresh(); } },
    onScroll: (d) => { selected = (selected + d + 17) % 17; hud.refresh(); },
    onMenu: () => inWorld.toggle(),
  });
  const mobile = isMobile() ? createMobileInput(document.getElementById('touchUI'), { onAct: act }) : null;

  sdk.multiplayer.on('disconnected', () => { showNotice('Session ended — the host left.'); setTimeout(() => location.reload(), 1800); });
  let running = true, last = performance.now(), posTimer = 0;
  if (sdk.onPause) sdk.onPause(() => { running = false; });
  if (sdk.onResume) sdk.onResume(() => { if (!running) { running = true; last = performance.now(); loop(last); } });
  window.addEventListener('beforeunload', () => { if (host && worldId && sdk.save) saveWorld(sdk, worldId, world); });

  function loop(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const intent = mobile ? mobile.pollIntent() : desktop.pollIntent();
    updateFlyCamera(cam, intent, dt);
    avatars.update(dt);
    posTimer += dt;
    if (posTimer >= 0.08) { posTimer = 0; session.sendPos(cam); }
    const target = raycast(world, cam.pos, lookDir(cam), REACH);
    view.setHighlight(target ? target.cell : null);
    view.render(cam);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

if (window.PlaySDK && window.PlaySDK.onReady) window.PlaySDK.onReady(boot); else boot();
