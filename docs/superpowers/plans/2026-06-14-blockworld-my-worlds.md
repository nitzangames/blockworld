# BlockWorld Plan 3 — My Worlds (Multi-World Management) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a player keep multiple named worlds — a My Worlds list to create, open, rename, and delete worlds — instead of the single `world:current`.

**Architecture:** A `worlds-index` key holds `[{id,name,updatedAt}]`; each world lives at `world:<id>` (same RLE format). A new `lib/persist/worlds.js` owns the index + per-world load/save (pure helpers unit-tested; sdk-backed ops tested with a mock SDK). The main menu becomes a My Worlds panel; opening a world hosts it (Plan 2's multiplayer is unchanged — you always host the world you open). Migration adopts any existing `world:current` as "My First World" so nothing is lost.

**Tech Stack:** Builds on Plans 1–2 (vanilla ES modules, three.js r128, vitest, PlaySDK). **Platform constraint:** the game runs in a sandboxed iframe WITHOUT `allow-modals`, so `prompt`/`confirm`/`alert` are no-ops — all naming/confirmation uses inline DOM inputs.

This is Plan 3. It implements the multi-world slice deferred from Plan 2. Spec:
`docs/superpowers/specs/2026-06-14-blockworld-multiplayer-builder-design.md` §7.

---

## File Structure (new/changed)

```
lib/persist/worlds.js   NEW — worlds-index + per-world load/save/delete, migration, autosaver
lib/ui/menus.js         CHANGED — showMainMenu becomes a My Worlds panel (inline inputs)
main.js                 CHANGED — list/open/new/rename/delete wiring; per-world autosave; DOM notice
test/worlds.test.js     NEW
```

`lib/persist/world-store.js` stays (its tests stay green); `main.js` stops importing it and uses
`worlds.js` instead. The migration in `worlds.js` reads the legacy `world:current` key directly.

---

## Task 1: worlds.js (index + per-world persistence)

**Files:** create `lib/persist/worlds.js`, `test/worlds.test.js`

- [ ] **Step 1: Write `test/worlds.test.js`**

```js
import { describe, it, expect, vi } from 'vitest';
import { createWorld, setBlock, getBlock } from '../lib/voxel/store.js';
import {
  newWorldId, upsertWorld, renameInIndex, removeFromIndex, touchWorld,
  loadIndex, saveIndex, loadWorld, saveWorld, getWorlds, makeWorldAutosaver,
} from '../lib/persist/worlds.js';

function mockSDK(initial = {}) {
  const kv = new Map(Object.entries(initial));
  return {
    kv,
    save: vi.fn((k, v) => { kv.set(k, v); return Promise.resolve(); }),
    load: vi.fn((k) => Promise.resolve(kv.has(k) ? kv.get(k) : null)),
  };
}

describe('worlds index (pure helpers)', () => {
  it('newWorldId returns w1 for empty, max+1 otherwise', () => {
    expect(newWorldId([])).toBe('w1');
    expect(newWorldId([{ id: 'w1' }, { id: 'w3' }])).toBe('w4');
  });
  it('upsert adds then updates by id', () => {
    const idx = [];
    upsertWorld(idx, { id: 'w1', name: 'A', updatedAt: 1 });
    upsertWorld(idx, { id: 'w1', name: 'A2', updatedAt: 2 });
    expect(idx).toEqual([{ id: 'w1', name: 'A2', updatedAt: 2 }]);
  });
  it('rename and remove and touch', () => {
    const idx = [{ id: 'w1', name: 'A', updatedAt: 1 }];
    renameInIndex(idx, 'w1', 'B');
    expect(idx[0].name).toBe('B');
    touchWorld(idx, 'w1', 99);
    expect(idx[0].updatedAt).toBe(99);
    expect(removeFromIndex(idx, 'w1')).toEqual([]);
  });
});

describe('worlds persistence (mock sdk)', () => {
  it('saves and loads a world by id', async () => {
    const sdk = mockSDK();
    const w = createWorld(); setBlock(w, 2, 1, 2, 6);
    await saveWorld(sdk, 'w1', w);
    expect(sdk.save).toHaveBeenCalledWith('world:w1', expect.any(String));
    const w2 = await loadWorld(sdk, 'w1');
    expect(getBlock(w2, 2, 1, 2)).toBe(6);
  });
  it('index round-trips as JSON', async () => {
    const sdk = mockSDK();
    await saveIndex(sdk, [{ id: 'w1', name: 'A', updatedAt: 5 }]);
    expect(await loadIndex(sdk)).toEqual([{ id: 'w1', name: 'A', updatedAt: 5 }]);
  });
  it('getWorlds migrates a legacy world:current into the index', async () => {
    const legacyBlob = 'LEGACYBLOB==';
    const sdk = mockSDK({ 'world:current': legacyBlob });
    const idx = await getWorlds(sdk, 1234);
    expect(idx).toEqual([{ id: 'w1', name: 'My First World', updatedAt: 1234 }]);
    expect(sdk.kv.get('world:w1')).toBe(legacyBlob); // blob copied verbatim
    expect(await loadIndex(sdk)).toEqual(idx);        // index persisted
  });
  it('getWorlds returns [] when nothing exists', async () => {
    expect(await getWorlds(mockSDK(), 1)).toEqual([]);
  });
  it('autosaver debounces and writes the world + bumps the index entry', async () => {
    vi.useFakeTimers();
    const sdk = mockSDK();
    const index = [{ id: 'w1', name: 'A', updatedAt: 0 }];
    const w = createWorld();
    const autosave = makeWorldAutosaver(sdk, 'w1', () => w, index, () => 777, 1000);
    autosave(); autosave();
    expect(sdk.save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(sdk.save).toHaveBeenCalledWith('world:w1', expect.any(String));
    expect(sdk.save).toHaveBeenCalledWith('worlds-index', expect.any(String));
    expect(index[0].updatedAt).toBe(777);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run `npm test -- worlds`, confirm FAIL.**

- [ ] **Step 3: Implement `lib/persist/worlds.js`**

```js
import { serialize, deserialize } from '../voxel/rle.js';

const INDEX_KEY = 'worlds-index';
const LEGACY_KEY = 'world:current';

// --- pure index helpers ---
export function newWorldId(index) {
  let max = 0;
  for (const w of index) {
    const n = parseInt(String(w.id).replace(/^w/, ''), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return 'w' + (max + 1);
}
export function upsertWorld(index, entry) {
  const i = index.findIndex((w) => w.id === entry.id);
  if (i >= 0) index[i] = { ...index[i], ...entry }; else index.push(entry);
  return index;
}
export function renameInIndex(index, id, name) {
  const w = index.find((x) => x.id === id); if (w) w.name = name; return index;
}
export function removeFromIndex(index, id) {
  return index.filter((w) => w.id !== id);
}
export function touchWorld(index, id, now) {
  const w = index.find((x) => x.id === id); if (w) w.updatedAt = now; return index;
}

// --- sdk-backed ---
export async function loadIndex(sdk) {
  const raw = await sdk.load(INDEX_KEY);
  if (!raw) return [];
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch { return []; }
}
export async function saveIndex(sdk, index) { await sdk.save(INDEX_KEY, JSON.stringify(index)); }

export async function loadWorld(sdk, id) {
  const raw = await sdk.load('world:' + id);
  return raw ? deserialize(raw) : null;
}
export async function saveWorld(sdk, id, world) { await sdk.save('world:' + id, serialize(world)); }

// PlaySDK KV has no delete; drop from the index (so it's unlisted) and blank the blob.
export async function deleteWorld(sdk, index, id) {
  const next = removeFromIndex(index, id);
  await saveIndex(sdk, next);
  await sdk.save('world:' + id, '');
  return next;
}

// Listing entrypoint with one-time migration of the legacy single world.
export async function getWorlds(sdk, now) {
  let index = await loadIndex(sdk);
  if (index.length === 0) {
    const legacy = await sdk.load(LEGACY_KEY);
    if (legacy) {
      await sdk.save('world:w1', legacy);
      index = [{ id: 'w1', name: 'My First World', updatedAt: now || 0 }];
      await saveIndex(sdk, index);
    }
  }
  return index;
}

// Debounced autosave for one world id: writes the blob and bumps its index entry.
// `nowFn` is injected so tests can pin the timestamp.
export function makeWorldAutosaver(sdk, id, getWorld, index, nowFn = () => Date.now(), delayMs = 3000) {
  let timer = null;
  return function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      timer = null;
      await saveWorld(sdk, id, getWorld());
      touchWorld(index, id, nowFn());
      await saveIndex(sdk, index);
    }, delayMs);
  };
}
```

- [ ] **Step 4: Run `npm test -- worlds`, confirm PASS (8 tests).**
- [ ] **Step 5: Commit** `git add lib/persist/worlds.js test/worlds.test.js && git commit -m "feat(persist): multi-world index + per-world load/save/delete + migration"`

---

## Task 2: My Worlds menu (sandbox-safe, no prompt/confirm)

**Files:** modify `lib/ui/menus.js`

Replace `showMainMenu` with a My Worlds panel. Keep `createInWorldMenu` unchanged. All text entry and
delete-confirmation is inline DOM (the iframe has no `allow-modals`).

- [ ] **Step 1: Replace the `showMainMenu` function in `lib/ui/menus.js`** with EXACTLY:

```js
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// worlds: [{id,name,updatedAt}]. Callbacks: onOpen(id), onNew(name), onRename(id,name),
// onDelete(id), onJoin(code). Returns { setStatus, setWorlds, close }.
export function showMainMenu({ worlds, displayName, onOpen, onNew, onRename, onDelete, onJoin }) {
  let list = worlds.slice();
  const el = document.createElement('div');
  el.id = 'mainmenu';
  el.style.cssText = 'position:absolute;inset:0;z-index:10;display:flex;align-items:center;justify-content:center;background:rgba(15,17,21,.93);color:#fff;font-family:system-ui,sans-serif;pointer-events:auto;overflow:auto';
  document.body.appendChild(el);

  function button(label, onClick, bg) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = `border:0;border-radius:8px;padding:7px 10px;cursor:pointer;font-size:14px;color:#fff;background:${bg || '#3a3f47'}`;
    b.onclick = onClick;
    return b;
  }

  function render() {
    el.innerHTML = `
      <div style="width:330px;max-width:92vw;padding:22px;background:#14171c;border-radius:16px">
        <h1 style="margin:0 0 2px;font-size:28px">BlockWorld</h1>
        <div style="opacity:.6;font-size:12px;margin-bottom:14px">${displayName ? 'Signed in as ' + esc(displayName) : 'Playing as guest'}</div>
        <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.6;margin-bottom:6px">My Worlds</div>
        <div id="mm-worlds" style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px"></div>
        <div style="display:flex;gap:6px;margin-bottom:14px">
          <input id="mm-newname" placeholder="New world name" style="flex:1;height:40px;border-radius:8px;border:2px solid #333;background:#1a1d23;color:#fff;padding:0 10px;font-size:14px">
          <button id="mm-new" style="height:40px;border:0;border-radius:8px;background:#5EA918;color:#fff;font-weight:600;padding:0 14px;cursor:pointer">Create</button>
        </div>
        <div style="text-align:center;opacity:.4;font-size:12px;margin-bottom:10px">— or join a friend —</div>
        <div style="display:flex;gap:6px">
          <input id="mm-code" placeholder="CODE" maxlength="6" style="flex:1;height:40px;text-align:center;text-transform:uppercase;border-radius:8px;border:2px solid #333;background:#1a1d23;color:#fff;font-size:16px">
          <button id="mm-join" style="height:40px;border:0;border-radius:8px;background:#3C44AA;color:#fff;font-weight:600;padding:0 14px;cursor:pointer">Join</button>
        </div>
        <div id="mm-status" style="height:16px;font-size:12px;color:#f8c627;margin-top:8px"></div>
      </div>`;

    const box = el.querySelector('#mm-worlds');
    if (!list.length) {
      box.innerHTML = '<div style="opacity:.5;font-size:13px;padding:4px 0">No worlds yet — name one below.</div>';
    }
    list.forEach((w) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:6px;background:#1c2027;border-radius:8px;padding:6px 8px';
      const name = document.createElement('span');
      name.textContent = w.name; name.style.cssText = 'flex:1;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      row.appendChild(name);
      row.appendChild(button('Open', () => onOpen(w.id), '#5EA918'));
      row.appendChild(button('✎', () => startRename(row, name, w)));
      row.appendChild(button('🗑', () => startDelete(row, w), '#7a2620'));
      box.appendChild(row);
    });

    el.querySelector('#mm-new').onclick = () => {
      const inp = el.querySelector('#mm-newname');
      const n = inp.value.trim();
      if (!n) { setStatus('Enter a world name'); inp.focus(); return; }
      onNew(n);
    };
    el.querySelector('#mm-join').onclick = () => {
      const c = el.querySelector('#mm-code').value.trim().toUpperCase();
      if (!c) { setStatus('Enter a code'); return; }
      onJoin(c);
    };
  }

  function startRename(row, nameSpan, w) {
    const inp = document.createElement('input');
    inp.value = w.name;
    inp.style.cssText = 'flex:1;height:30px;border-radius:6px;border:2px solid #4c8bf5;background:#11141a;color:#fff;padding:0 8px;font-size:14px';
    row.replaceChild(inp, nameSpan); inp.focus(); inp.select();
    const commit = () => { const n = inp.value.trim(); if (n && n !== w.name) onRename(w.id, n); else render(); };
    inp.onkeydown = (e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') render(); };
    inp.onblur = commit;
  }

  function startDelete(row, w) {
    row.innerHTML = '';
    const q = document.createElement('span');
    q.textContent = `Delete “${w.name}”?`; q.style.cssText = 'flex:1;font-size:14px';
    row.appendChild(q);
    row.appendChild(button('Delete', () => onDelete(w.id), '#b02e26'));
    row.appendChild(button('Cancel', () => render(), '#3a3f47'));
  }

  function setStatus(t) { const s = el.querySelector('#mm-status'); if (s) s.textContent = t; }
  render();
  return {
    setStatus,
    setWorlds: (next) => { list = next.slice(); render(); },
    close: () => el.remove(),
  };
}
```

- [ ] **Step 2: `node --check lib/ui/menus.js`** — must pass.
- [ ] **Step 3: Commit** `git add lib/ui/menus.js && git commit -m "feat(ui): My Worlds menu panel with inline create/rename/delete (sandbox-safe)"`

---

## Task 3: Wire My Worlds into main.js + finalize

**Files:** modify `main.js`

- [ ] **Step 1: Update imports in `main.js`** — replace the persistence import line
`import { loadCurrent, saveCurrent, makeAutosaver } from './lib/persist/world-store.js';`
with:
```js
import { getWorlds, loadWorld, saveWorld, newWorldId, upsertWorld, renameInIndex, deleteWorld, makeWorldAutosaver } from './lib/persist/worlds.js';
```

- [ ] **Step 2: Replace the `boot()` function body** so the menu is driven by the worlds index. Replace
the existing `async function boot() { ... }` with:
```js
async function boot() {
  const sdk = window.PlaySDK;
  const displayName = sdk && sdk.getDisplayName ? await sdk.getDisplayName().catch(() => null) : null;
  let index = sdk && sdk.load ? await getWorlds(sdk, Date.now()).catch(() => []) : [];

  const menu = showMainMenu({
    worlds: index,
    displayName,
    onOpen: (id) => startHost(id),
    onNew: async (name) => {
      const id = newWorldId(index);
      const w = createWorld(); fillFloor(w, 8);
      if (sdk && sdk.save) { await saveWorld(sdk, id, w); upsertWorld(index, { id, name, updatedAt: Date.now() }); await saveIndexSafe(); }
      startHost(id, w);
    },
    onRename: async (id, name) => { renameInIndex(index, id, name); await saveIndexSafe(); menu.setWorlds(index); },
    onDelete: async (id) => { index = sdk && sdk.save ? await deleteWorld(sdk, index, id) : index.filter((x) => x.id !== id); menu.setWorlds(index); },
    onJoin: (code) => startVisitor(code),
  });

  async function saveIndexSafe() { try { if (sdk && sdk.save) await (await import('./lib/persist/worlds.js')).saveIndex(sdk, index); } catch {} }

  async function startHost(worldId, preworld) {
    let room;
    try { room = await sdk.multiplayer.createRoom({ maxPlayers: 8, visibility: 'private' }); }
    catch (e) { menu.setStatus('Could not host: ' + (e && e.message ? e.message : 'try again')); return; }
    const transport = makePlayTransport(sdk, room, room.hostId);
    menu.close();
    runGame({ sdk, room, transport, ownerId: room.hostId, host: true, myName: displayName || 'Guest', worldId, preworld, index });
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
```
Add `import { saveIndex } from './lib/persist/worlds.js';` is NOT needed — `saveIndexSafe` dynamic-imports it; but simpler: add `saveIndex` to the Step-1 import list and replace `saveIndexSafe` body with `try { if (sdk && sdk.save) await saveIndex(sdk, index); } catch {}`. Do that — update the Step-1 import to include `saveIndex` and use it directly (drop the dynamic import).

- [ ] **Step 3: Update `runGame(...)` signature and the host world-load + autosave.** Change the
signature to accept the new fields and replace the host load + autosave logic:
```js
function runGame({ sdk, room, transport, ownerId, host, myName, worldId, preworld, index }) {
  let world = preworld || createWorld();
  const view = createWorldView(canvas, world);
  const avatars = createAvatars(view.scene);
  const cam = createFlyCamera([WX / 2, 4, WZ / 2], 0, -0.35);
  const autosave = host && worldId && sdk && sdk.save
    ? makeWorldAutosaver(sdk, worldId, () => world, index, () => Date.now(), 3000)
    : () => {};

  function rebindWorld() { view.setWorld(world); view.rebuildAll(); }
  // ... createSession({...}) unchanged ...

  if (host) {
    if (preworld) { world = preworld; rebindWorld(); }
    else if (sdk && sdk.load && worldId) {
      loadWorld(sdk, worldId).then((w) => { if (w) world = w; else { world = createWorld(); fillFloor(world, 8); } rebindWorld(); }).catch(() => { world = createWorld(); fillFloor(world, 8); rebindWorld(); });
    } else { world = createWorld(); fillFloor(world, 8); rebindWorld(); }
  }
  // ... rest unchanged (act, hud, inWorld menu, inputs, loop) ...
}
```
Keep the rest of `runGame` (the `act()`, `createHUD`, `createInWorldMenu`, inputs, pos loop, render loop, `beforeunload`) as-is, EXCEPT:
- The `beforeunload` handler currently calls `saveCurrent`; change it to `if (host && worldId && sdk.save) saveWorld(sdk, worldId, world);`.
- The `applyRemoteEdit` hook's `if (host) autosave();` stays (autosave is now the per-world autosaver).

- [ ] **Step 4: Replace the host-left `alert(...)`** (sandbox has no modals) with a DOM notice. Change:
```js
sdk.multiplayer.on('disconnected', () => { alert('Session ended (host left).'); location.reload(); });
```
to:
```js
sdk.multiplayer.on('disconnected', () => { showNotice('Session ended — the host left.'); setTimeout(() => location.reload(), 1800); });
```
and add this helper near the top of `main.js` (module scope, after `const canvas = ...`):
```js
function showNotice(text) {
  const n = document.createElement('div');
  n.textContent = text;
  n.style.cssText = 'position:absolute;left:50%;top:18px;transform:translateX(-50%);z-index:30;background:rgba(20,23,28,.95);color:#fff;padding:10px 16px;border-radius:10px;font-family:system-ui,sans-serif;font-size:14px;pointer-events:none';
  document.body.appendChild(n);
  setTimeout(() => n.remove(), 4000);
}
```

- [ ] **Step 5: Verify** — `node --check main.js`; `npm test` (Plan 1–2 suites + the 8 new worlds tests, all pass); `npm run smoke` (boots to the main menu — now the My Worlds panel — and the `#mainmenu` assertion still holds).

- [ ] **Step 6: Bump version to v0.4.0** in `index.html` (meta tag + `#ver` span) and `package.json`; verify `grep -c v0.4.0 index.html` is 2 and no `v0.3.` remains.

- [ ] **Step 7: Commit** `git add main.js index.html package.json && git commit -m "feat: My Worlds — create/open/rename/delete multiple worlds; per-world autosave; v0.4.0"`

---

## Task 4: Regenerate thumbnail + redeploy note

- [ ] **Step 1:** No thumbnail change needed (the world look is unchanged). Skip unless the menu changed
the first-load visuals materially.
- [ ] **Step 2:** Do NOT auto-deploy. Per the deploy-gating rule, the user verifies locally then chooses
to deploy. When they do: `zip -rq /tmp/blockworld.zip index.html meta.json thumbnail.png main.js lib vendor`
then the deploy-key `curl` — a re-deploy PRESERVES the current `pending` status (no re-approval). Note this
in the completion report; don't run it.

---

## Self-Review (completed during authoring)

- **Spec coverage:** §7 multi-world index + per-world keys + migration → Task 1; My Worlds UI (create/
  open/rename/delete) → Tasks 2–3; per-world host autosave → Task 3. Thumbnails-in-list still out (noted).
- **Placeholders:** none — full code given. The Step-2 note tells the implementer to fold `saveIndex` into
  the Task-1 import and drop the dynamic import (do that; don't ship the dynamic-import form).
- **Sandbox safety:** no `prompt`/`confirm`/`alert` — inline inputs for naming/rename, inline two-button
  delete confirm, and the host-left `alert` is replaced with `showNotice`.
- **Type/name consistency:** `worlds.js` exports (`getWorlds/loadWorld/saveWorld/newWorldId/upsertWorld/
  renameInIndex/deleteWorld/touchWorld/saveIndex/loadIndex/makeWorldAutosaver`) match their uses in `main.js`
  and the test. `showMainMenu({worlds,displayName,onOpen,onNew,onRename,onDelete,onJoin})` matches main's call
  and returns `{setStatus,setWorlds,close}` as used. `runGame` new fields (`worldId,preworld,index`) are
  threaded from both `startHost` and `startVisitor` (visitor passes none → host-only autosave guards on
  `worldId`).
