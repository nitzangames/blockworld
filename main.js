import { createWorld, fillFloor } from './lib/voxel/store.js';
import { createWorldView, isMobile } from './lib/render/world-view.js';
import { createFlyCamera, updateFlyCamera, lookDir } from './lib/player/fly-camera.js';
import { raycast } from './lib/voxel/raycast.js';
import { applyEdit } from './lib/voxel/edit.js';
import { createDesktopInput } from './lib/input/desktop.js';
import { createMobileInput } from './lib/input/mobile.js';
import { createHUD } from './lib/ui/hud.js';
import { loadCurrent, saveCurrent, makeAutosaver } from './lib/persist/world-store.js';
import { WX, WZ } from './lib/constants.js';
import { createSession } from './lib/net/session.js';
import { makePlayTransport } from './lib/net/play-transport.js';
import { createAvatars } from './lib/render/avatars.js';
import { showMainMenu, createInWorldMenu } from './lib/ui/menus.js';

const REACH = 8;
let selected = 1;
const canvas = document.getElementById('c');

async function boot() {
  const sdk = window.PlaySDK;
  const displayName = sdk && sdk.getDisplayName ? await sdk.getDisplayName().catch(() => null) : null;

  const menu = showMainMenu({
    displayName,
    onHost: () => start({ host: true }),
    onJoin: (code) => start({ host: false, code }),
  });

  async function start({ host, code }) {
    let room, transport, ownerId;
    try {
      if (host) {
        room = await sdk.multiplayer.createRoom({ maxPlayers: 8, visibility: 'private' });
        ownerId = room.hostId;
      } else {
        room = await sdk.multiplayer.joinRoom(code);
        ownerId = room.hostId;
      }
    } catch (e) {
      // Hosting/joining works for guest accounts too — surface the real error rather than
      // assuming the user isn't signed in.
      menu.setStatus((host ? 'Could not host: ' : 'Join failed: ') + (e && e.message ? e.message : 'try again'));
      return;
    }
    // The SDK exposes no public userId getter; session.js no longer needs our own id (PERM is
    // targeted), so a placeholder is fine for the transport.
    transport = makePlayTransport(sdk, room, ownerId);
    menu.close();
    runGame({ sdk, room, transport, ownerId, host, myName: displayName || 'Guest' });
  }
}

function runGame({ sdk, room, transport, ownerId, host, myName }) {
  let world = createWorld();
  const view = createWorldView(canvas, world);
  const avatars = createAvatars(view.scene);
  const cam = createFlyCamera([WX / 2, 4, WZ / 2], 0, -0.35);
  const autosave = host && sdk && sdk.save ? makeAutosaver(sdk, () => world, 3000) : () => {};

  function rebindWorld() { view.setWorld(world); view.rebuildAll(); }

  const session = createSession({
    transport, ownerId, myName, getWorld: () => world,
    hooks: {
      worldName: 'World',
      onSnapshot: (w) => { world = w; rebindWorld(); },
      applyRemoteEdit: (x, y, z, b, dirty) => { dirty.forEach((id) => view.rebuildChunk(id)); if (host) autosave(); },
      onPos: (userId, p) => avatars.setTarget(userId, p.n || 'Player', p),
      onPlayerLeft: (userId) => avatars.remove(userId),
      onPlayers: () => inWorld.refresh(),
      onPermChange: () => {},
      onEnded: () => {},
    },
  });

  if (host) {
    world = createWorld(); fillFloor(world, 8);
    if (sdk && sdk.load) loadCurrent(sdk).then((w) => { if (w) world = w; rebindWorld(); }).catch(rebindWorld);
    else rebindWorld();
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
    getState: () => ({ isHost: host, code: room.code, players: session.players() }),
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

  sdk.multiplayer.on('disconnected', () => { alert('Session ended (host left).'); location.reload(); });
  let running = true, last = performance.now(), posTimer = 0;
  if (sdk.onPause) sdk.onPause(() => { running = false; });
  if (sdk.onResume) sdk.onResume(() => { if (!running) { running = true; last = performance.now(); loop(last); } });
  window.addEventListener('beforeunload', () => { if (host && sdk.save) saveCurrent(sdk, world); });

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
