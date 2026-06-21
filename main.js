import { createWorld, fillFloor } from './lib/voxel/store.js';
import { createWorldView, isMobile } from './lib/render/world-view.js';
import { createFlyCamera, updateFlyCamera, lookDir } from './lib/player/fly-camera.js';
import { updateWalkCamera } from './lib/player/walk-camera.js';
import { raycast } from './lib/voxel/raycast.js';
import { createDesktopInput } from './lib/input/desktop.js';
import { createMobileInput } from './lib/input/mobile.js';
import { createHUD } from './lib/ui/hud.js';
import { getWorlds, loadWorld, saveWorld, saveIndex, newWorldId, upsertWorld, renameInIndex, deleteWorld, makeWorldAutosaver, makeWorldPublisher, setPrivacy, forkWorld } from './lib/persist/worlds.js';
import { serialize, deserialize } from './lib/voxel/rle.js';
import { listPublished, getPublished } from './lib/persist/published.js';
import { WX, WY, WZ } from './lib/constants.js';
import { createSession } from './lib/net/session.js';
import { makePlayTransport } from './lib/net/play-transport.js';
import { createAvatars } from './lib/render/avatars.js';
import { showMainMenu, createInWorldMenu } from './lib/ui/menus.js';
import { resolveDisplayName, watchDisplayName } from './lib/identity.js';

// Reach spans the whole world (its diagonal), so you can target any block you can see — no limit.
const REACH = Math.ceil(Math.hypot(WX, WY, WZ));
let selected = 1;
const canvas = document.getElementById('c');
// Single source of truth for the displayed build number (kept in sync with the <meta> + topbar).
const GAME_VERSION = (document.querySelector('meta[name="game-version"]') || {}).content || '';

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

// Branded boot overlay shown from first paint until the menu is ready (covers the
// auth handshake / server wait so the player never sees a bare canvas or a guest flash).
function showBootLoading() {
  const o = document.createElement('div');
  o.id = 'bootloading';
  o.style.cssText = 'position:absolute;inset:0;z-index:25;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;background:#14171c;color:#fff;font-family:system-ui,sans-serif;pointer-events:auto';
  o.innerHTML =
    '<style>@keyframes bw-spin{to{transform:rotate(360deg)}}</style>' +
    '<div style="font-size:30px;font-weight:800">BlockWorld</div>' +
    '<div style="width:34px;height:34px;border-radius:50%;border:3px solid rgba(255,255,255,.16);border-top-color:#5EA918;animation:bw-spin .8s linear infinite"></div>' +
    '<div style="font-size:13px;opacity:.55">Connecting…</div>' +
    '<div style="position:absolute;bottom:16px;font-size:12px;opacity:.4">' + GAME_VERSION + '</div>';
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
  // Hold the boot loading screen until the signed-in identity resolves (the async token+profile
  // handshake can take up to ~2s), capped so anonymous players aren't stuck. resolveDisplayName
  // returns the instant the name lands (or null at the cap). Cloud saves load in the same
  // handshake, so the worlds read just below is current once the name is known.
  let displayName = await resolveDisplayName(sdk, { tries: 8, intervalMs: 300 });
  let index = sdk && sdk.load ? await getWorlds(sdk, Date.now()).catch(() => []) : [];

  async function saveIndexSafe() { try { if (sdk && sdk.save) await saveIndex(sdk, index); } catch {} }

  const menu = showMainMenu({
    worlds: index,
    displayName,
    version: GAME_VERSION,
    defaultName: defaultWorldName(index),
    onListRooms: () => (sdk && sdk.multiplayer && sdk.multiplayer.listRooms ? sdk.multiplayer.listRooms() : Promise.resolve([])),
    onOpen: (id) => startHost(id),
    onNew: async (name) => {
      const id = newWorldId(index);
      const w = createWorld(); fillFloor(w, 8);
      if (sdk && sdk.save) { await saveWorld(sdk, id, w); upsertWorld(index, { id, name, updatedAt: Date.now(), privacy: 'public' }); await saveIndexSafe(); }
      startHost(id, w, name);
    },
    onRename: async (id, name) => { renameInIndex(index, id, name); await saveIndexSafe(); menu.setWorlds(index); },
    onDelete: async (id) => { index = sdk && sdk.save ? await deleteWorld(sdk, index, id) : index.filter((x) => x.id !== id); menu.setWorlds(index); },
    onPrivacy: async (id, privacy) => { setPrivacy(index, id, privacy); await saveIndexSafe(); if (sdk && sdk.publishWorld) { try { const e = index.find((w) => w.id === id); const w = await loadWorld(sdk, id); if (w) await sdk.publishWorld({ worldId: id, title: (e && e.name) || 'World', blob: serialize(w), privacy }); } catch (e) {} } },
    onJoin: (code) => startVisitor(code),
    onListPublished: () => listPublished('blockworld'),
    onVisit: async (publishId) => {
      const overlay = showLoading('Loading world…');
      const pub = await getPublished(publishId);
      if (!pub) { overlay.remove(); menu.setStatus('That world is no longer available'); return; }
      let world; try { world = deserialize(pub.blob); } catch { overlay.remove(); menu.setStatus('That world could not be loaded'); return; }
      menu.close(); overlay.remove();
      const onCopy = pub.copyable && sdk ? async () => {
        const name = pub.title + ' (copy)';
        const fork = forkWorld(index, pub.blob, name); // {id, world}; entry already added with this name
        if (sdk.save) { await saveWorld(sdk, fork.id, fork.world); await saveIndexSafe(); }
        startHost(fork.id, fork.world, name); // open the copy as your own editable world
      } : null;
      runVisit(world, { title: pub.title }, onCopy);
    },
  });
  if (bootLoadingEl) bootLoadingEl.remove(); // menu is built underneath; reveal it

  // The auth token (and cloud saves) can land after the menu first renders. When the real
  // identity resolves, update the greeting + the name used for hosting, and refresh the
  // worlds list (cloud saves loaded with the same handshake). Fixes "Playing as guest"
  // showing for a signed-in user when the token arrives after the SDK's ready timeout.
  watchDisplayName(sdk, async (name) => {
    displayName = name;
    menu.setDisplayName(name);
    if (sdk && sdk.load) { try { index = await getWorlds(sdk, Date.now()); menu.setWorlds(index); } catch {} }
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

// Solo, read-only viewer for a published world snapshot. No multiplayer, no building, no autosave.
// `onCopy` (when provided) forks the snapshot into the visitor's own worlds.
function runVisit(world, meta, onCopy) {
  const view = createWorldView(canvas, world);
  const cam = createFlyCamera([WX / 2, 8, WZ / 2], 0, -0.35);
  view.rebuildAll();
  let mode = 'explore'; // start walking through it; toggle to fly with the same button
  const modeBtn = document.getElementById('modeBtn');
  if (modeBtn) { modeBtn.textContent = 'Walk'; modeBtn.onclick = () => { mode = mode === 'edit' ? 'explore' : 'edit'; cam.vel[0] = cam.vel[1] = cam.vel[2] = 0; cam.grounded = false; modeBtn.textContent = mode === 'edit' ? 'Fly' : 'Walk'; }; }

  const bar = document.createElement('div');
  bar.style.cssText = 'position:absolute;top:48px;left:12px;z-index:11;display:flex;gap:8px;align-items:center;background:rgba(20,23,28,.92);color:#fff;border-radius:10px;padding:8px 10px;font-family:system-ui,sans-serif;pointer-events:auto';
  bar.innerHTML = `<span style="font-size:13px">Visiting <b>${meta.title}</b></span>`;
  if (onCopy) { const c = document.createElement('button'); c.textContent = 'Make a copy'; c.style.cssText = 'border:0;border-radius:8px;background:#5EA918;color:#fff;padding:6px 10px;cursor:pointer'; c.onclick = () => onCopy(); bar.appendChild(c); }
  const leave = document.createElement('button'); leave.textContent = 'Leave'; leave.style.cssText = 'border:0;border-radius:8px;background:#b02e26;color:#fff;padding:6px 10px;cursor:pointer'; leave.onclick = () => location.reload(); bar.appendChild(leave);
  document.body.appendChild(bar);

  const desktop = createDesktopInput(canvas, { onAct: () => {}, onPick: () => {}, onScroll: () => {}, onMenu: () => {} });
  const mobile = isMobile() ? createMobileInput(document.getElementById('touchUI'), { onAct: () => {} }) : null;
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const intent = mobile ? mobile.pollIntent() : desktop.pollIntent();
    if (mode === 'explore') updateWalkCamera(cam, intent, dt, world); else updateFlyCamera(cam, intent, dt);
    view.setHighlight(null);
    view.render(cam);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

function runGame({ sdk, room, transport, ownerId, host, myName, worldId, preworld, index, worldName }) {
  let mode = 'edit';
  let world = preworld || createWorld();
  const view = createWorldView(canvas, world);
  const avatars = createAvatars(view.scene);
  const cam = createFlyCamera([WX / 2, 4, WZ / 2], 0, -0.35);
  const clientId = 'c' + Math.floor(Math.random() * 1e9);
  let loadingEl = host ? null : showLoading('Loading world…');
  const autosave = host && worldId && sdk && sdk.save
    ? makeWorldAutosaver(sdk, worldId, () => world, index, () => Date.now(), 3000)
    : () => {};
  const publisher = host && worldId && sdk && sdk.publishWorld
    ? makeWorldPublisher(sdk, {
        worldId,
        getBlob: () => serialize(world),
        getMeta: () => { const e = (index || []).find((w) => w.id === worldId); return { title: (e && e.name) || worldName || 'World', privacy: (e && e.privacy) || 'public' }; },
      })
    : Object.assign(() => {}, { flush: () => {} });

  function rebindWorld() { view.setWorld(world); view.rebuildAll(); }

  let inWorld; // assigned below; referenced by the session's onWelcome hook (fires async)
  const session = createSession({
    transport, ownerId, myName, clientId, getWorld: () => world,
    hooks: {
      worldName: worldName || 'World',
      onWelcome: () => inWorld.refresh(),
      onSnapshot: (w) => { world = w; rebindWorld(); if (loadingEl) { loadingEl.remove(); loadingEl = null; } },
      applyRemoteEdit: (x, y, z, b, dirty) => { dirty.forEach((id) => view.rebuildChunk(id)); if (host) { autosave(); publisher(); } },
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
      if (!loadingEl) loadingEl = showLoading('Loading world…');
      const done = () => { rebindWorld(); if (loadingEl) { loadingEl.remove(); loadingEl = null; } };
      loadWorld(sdk, worldId).then((w) => { if (w) world = w; else { world = createWorld(); fillFloor(world, 8); } done(); }).catch(() => { world = createWorld(); fillFloor(world, 8); done(); });
    } else { world = createWorld(); fillFloor(world, 8); rebindWorld(); }
  }

  function act() {
    if (mode !== 'edit') return; // Explore is move-only
    if (!session.canEditLocal()) return;
    const hit = raycast(world, cam.pos, lookDir(cam), REACH);
    if (!hit) return;
    let x, y, z, b;
    if (selected === 0) { [x, y, z] = hit.cell; b = 0; }
    else { x = hit.cell[0] + hit.normal[0]; y = hit.cell[1] + hit.normal[1]; z = hit.cell[2] + hit.normal[2]; b = selected; }
    session.requestEdit(x, y, z, b);
  }

  const hud = createHUD({ onPick: (i) => { selected = i; hud.refresh(); }, getSelected: () => selected });
  inWorld = createInWorldMenu({
    getState: () => ({ isHost: host, code: room.code, worldName: session.worldName(), players: session.players() }),
    onToggle: (userId, canEdit) => session.setPermission(userId, canEdit),
    onLeave: () => { try { publisher.flush(); } catch (e) {} try { room.leave(); } catch (e) {} location.reload(); },
  });
  document.getElementById('menuBtn').addEventListener('click', () => inWorld.toggle());

  // Cube-outline toggle (top-right). On by default; choice persists per device.
  const outlineBtn = document.getElementById('outlineBtn');
  if (outlineBtn) {
    let on = true;
    try { const s = localStorage.getItem('blockworld:outlines'); if (s !== null) on = s === '1'; } catch (e) {}
    view.setOutlines(on);
    const paintOutlineBtn = () => { outlineBtn.style.opacity = view.getOutlines() ? '1' : '0.4'; };
    paintOutlineBtn();
    outlineBtn.addEventListener('click', () => {
      const next = !view.getOutlines();
      view.setOutlines(next);
      try { localStorage.setItem('blockworld:outlines', next ? '1' : '0'); } catch (e) {}
      paintOutlineBtn();
    });
  }

  // Edit (fly) vs Explore (walk). Edit is the default; Explore is move-only.
  const modeBtn = document.getElementById('modeBtn');
  if (modeBtn) {
    modeBtn.textContent = 'Fly';
    modeBtn.addEventListener('click', () => {
      mode = mode === 'edit' ? 'explore' : 'edit';
      cam.vel[0] = 0; cam.vel[1] = 0; cam.vel[2] = 0; // don't carry momentum across modes
      cam.grounded = false;
      modeBtn.textContent = mode === 'edit' ? 'Fly' : 'Walk';
    });
  }

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
  window.addEventListener('beforeunload', () => { if (host && worldId && sdk.save) { saveWorld(sdk, worldId, world); publisher.flush(); } });

  function loop(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const intent = mobile ? mobile.pollIntent() : desktop.pollIntent();
    if (mode === 'explore') updateWalkCamera(cam, intent, dt, world); else updateFlyCamera(cam, intent, dt);
    avatars.update(dt);
    posTimer += dt;
    if (posTimer >= 0.08) { posTimer = 0; session.sendPos(cam); }
    const target = mode === 'edit' ? raycast(world, cam.pos, lookDir(cam), REACH) : null;
    view.setHighlight(target ? target.cell : null);
    view.render(cam);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

const bootLoadingEl = showBootLoading(); // visible immediately, removed once the menu is ready
boot();
