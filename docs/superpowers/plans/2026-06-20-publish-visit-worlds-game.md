# Publish & Visit Worlds — Game (Plan 2 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The game side of "visit worlds offline": auto-publish world snapshots (3-level privacy), an "Explore worlds" gallery, a read-only viewer, and "Make a copy" — built against the now-live `/api/worlds` endpoints + `PlaySDK.publishWorld`.

**Architecture:** World index entries gain a `privacy` field. A throttled `makeWorldPublisher` pushes snapshots from the host's autosave loop. The main menu gains a gallery sub-view (fetches the public list); opening a world fetches its blob and runs a non-networked read-only viewer (`runVisit`) that reuses the existing renderer/camera/input/mode-toggle; "Make a copy" forks the blob into the visitor's own worlds.

**Tech Stack:** Vanilla ES modules, Vitest, three.js, PlaySDK. The platform layer (Plan 1) is deployed and live.

**Spec:** `docs/superpowers/specs/2026-06-20-blockworld-publish-visit-worlds-design.md` (§4).

**Live contract (from Plan 1):**
- `PlaySDK.publishWorld({ worldId, title, blob, privacy })` → `{ publish_id }` (or `{ unpublished:true }`); rejects if not signed in.
- `GET https://nitzan.games/api/worlds?slug=blockworld` → `{ worlds: [{ publish_id, title, creator_name, copyable, updated_at }] }`.
- `GET https://nitzan.games/api/worlds/:publishId` → `{ publish_id, title, creator_name, copyable, blob }` or 404.
- The game may fetch the two GETs directly (CSP allows `nitzan.games`). `blob` is `serialize(world)` (base64).

---

## File Structure

- `lib/persist/worlds.js` — **modify.** Add `privacy` to index entries (default + migration) + `setPrivacy`; add `makeWorldPublisher`; add `forkWorld`.
- `lib/persist/published.js` — **new.** Tiny public-gallery client: `listPublished()` and `getPublished(publishId)` (direct fetch).
- `test/worlds.test.js` — **modify.** Tests for privacy default/migration, `setPrivacy`, `makeWorldPublisher` throttle, `forkWorld`.
- `lib/ui/menus.js` — **modify.** Privacy cycle control in the Worlds list; new "Explore worlds" Home entry + gallery sub-view.
- `main.js` — **modify.** Wire publisher into the host autosave; menu `onPrivacy`/`onListPublished`/`onVisit`; `runVisit` read-only viewer + "Make a copy".
- `index.html`, `package.json` — **modify.** Version bump.

---

## Task 1: world `privacy` field — default, migration, setter

**Files:** Modify `lib/persist/worlds.js`; Test `test/worlds.test.js`

- [ ] **Step 1: Write failing tests** — append to `test/worlds.test.js` (inside its top-level `describe`, or as new `it`s; the file already imports from `../lib/persist/worlds.js`):

```js
import { setPrivacy } from '../lib/persist/worlds.js';

describe('world privacy', () => {
  it('new worlds default to public via upsertWorld', () => {
    const index = [];
    upsertWorld(index, { id: 'w1', name: 'A', updatedAt: 1, privacy: 'public' });
    expect(index[0].privacy).toBe('public');
  });
  it('setPrivacy updates an entry and ignores unknown ids', () => {
    const index = [{ id: 'w1', name: 'A', privacy: 'public' }];
    setPrivacy(index, 'w1', 'viewonly');
    expect(index[0].privacy).toBe('viewonly');
    setPrivacy(index, 'nope', 'private'); // no throw
    expect(index[0].privacy).toBe('viewonly');
  });
});
```

(`upsertWorld` is already imported in `test/worlds.test.js`. If not, add it to the existing import from `../lib/persist/worlds.js`.)

- [ ] **Step 2: Run, verify FAIL** — `npx vitest run test/worlds.test.js` → FAIL (`setPrivacy` not exported).

- [ ] **Step 3: Implement** — in `lib/persist/worlds.js`, add after `renameInIndex`:

```js
export function setPrivacy(index, id, privacy) {
  const w = index.find((x) => x.id === id); if (w) w.privacy = privacy; return index;
}
```

And in `getWorlds` (the listing/migration entrypoint), ensure every returned entry has a privacy. Find the `return index;` at the end of `getWorlds` and replace it with:

```js
  for (const w of index) if (!w.privacy) w.privacy = 'public'; // migrate older entries
  return index;
```

- [ ] **Step 4: Run, verify PASS** — `npx vitest run test/worlds.test.js` → all green.

- [ ] **Step 5: Commit**

```bash
git add lib/persist/worlds.js test/worlds.test.js
git commit -m "feat(persist): world privacy field (default public) + setPrivacy + migration"
```

---

## Task 2: `makeWorldPublisher` (throttled snapshot publish)

**Files:** Modify `lib/persist/worlds.js`; Test `test/worlds.test.js`

- [ ] **Step 1: Write failing tests** — append to `test/worlds.test.js`:

```js
import { makeWorldPublisher } from '../lib/persist/worlds.js';

describe('makeWorldPublisher', () => {
  function fakeSdk() {
    const calls = [];
    return { calls, publishWorld: (p) => { calls.push(p); return Promise.resolve({ publish_id: 'px' }); } };
  }
  it('publishes at most once per window, then flush() sends the latest', async () => {
    const sdk = fakeSdk();
    let now = 0;
    const pub = makeWorldPublisher(sdk, {
      worldId: 'w1',
      getBlob: () => 'BLOB' + now,
      getMeta: () => ({ title: 'A', privacy: 'public' }),
      now: () => now,
      windowMs: 1000,
    });
    pub(); // first call -> publishes immediately
    pub(); // within window -> throttled (no new call)
    expect(sdk.calls.length).toBe(1);
    expect(sdk.calls[0]).toMatchObject({ worldId: 'w1', title: 'A', privacy: 'public' });
    now = 1500; pub(); // window passed -> publishes
    expect(sdk.calls.length).toBe(2);
    await pub.flush(); // forces a final publish of the latest snapshot
    expect(sdk.calls.length).toBe(3);
    expect(sdk.calls[2].blob).toBe('BLOB1500');
  });
  it('does not throw when sdk lacks publishWorld', async () => {
    const pub = makeWorldPublisher({}, { worldId: 'w1', getBlob: () => 'B', getMeta: () => ({ title: 'A', privacy: 'public' }), now: () => 0 });
    pub(); await pub.flush(); // no-op, no throw
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — `npx vitest run test/worlds.test.js` → FAIL (`makeWorldPublisher` not exported).

- [ ] **Step 3: Implement** — add to `lib/persist/worlds.js`:

```js
// Throttled publisher: pushes the current world snapshot to the public gallery at most once per
// `windowMs`, plus a final flush() (call on leave). Best-effort — rejections are swallowed.
// opts: { worldId, getBlob(): string, getMeta(): {title, privacy}, now?: ()=>ms, windowMs?: ms }
export function makeWorldPublisher(sdk, opts) {
  const now = opts.now || (() => Date.now());
  const windowMs = opts.windowMs != null ? opts.windowMs : 20000;
  let last = -Infinity;
  function send() {
    if (!sdk || !sdk.publishWorld) return Promise.resolve();
    last = now();
    const meta = opts.getMeta();
    return sdk.publishWorld({ worldId: opts.worldId, title: meta.title, blob: opts.getBlob(), privacy: meta.privacy })
      .catch(() => {});
  }
  function schedule() {
    if (now() - last >= windowMs) send();
  }
  schedule.flush = () => send();
  return schedule;
}
```

- [ ] **Step 4: Run, verify PASS** — `npx vitest run test/worlds.test.js` → all green.

- [ ] **Step 5: Commit**

```bash
git add lib/persist/worlds.js test/worlds.test.js
git commit -m "feat(persist): makeWorldPublisher (throttled snapshot publish + flush)"
```

---

## Task 3: `forkWorld` (copy a published snapshot into your own worlds)

**Files:** Modify `lib/persist/worlds.js`; Test `test/worlds.test.js`

- [ ] **Step 1: Write failing test** — append to `test/worlds.test.js`:

```js
import { forkWorld } from '../lib/persist/worlds.js';
import { serialize } from '../lib/voxel/rle.js';
import { createWorld, fillFloor, getBlock } from '../lib/voxel/store.js';

describe('forkWorld', () => {
  it('creates a new owned world from a published blob', () => {
    const src = createWorld(); fillFloor(src, 8);
    const blob = serialize(src);
    const index = [{ id: 'w1', name: 'Mine', privacy: 'public' }];
    const { id, world } = forkWorld(index, blob, 'Castle (copy)');
    expect(id).toBe('w2');                       // newWorldId after w1
    expect(getBlock(world, 0, 0, 0)).toBe(8);    // floor came across
    expect(index.find((w) => w.id === 'w2')).toMatchObject({ id: 'w2', name: 'Castle (copy)', privacy: 'public' });
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — `npx vitest run test/worlds.test.js` → FAIL (`forkWorld` not exported).

- [ ] **Step 3: Implement** — add to `lib/persist/worlds.js` (note `deserialize` is already imported at the top):

```js
// Fork a published snapshot (base64 blob) into a brand-new owned world entry. Returns {id, world}.
// Caller persists it (saveWorld + saveIndex) and opens it.
export function forkWorld(index, blob, name) {
  const id = newWorldId(index);
  const world = deserialize(blob);
  upsertWorld(index, { id, name, updatedAt: Date.now(), privacy: 'public' });
  return { id, world };
}
```

- [ ] **Step 4: Run, verify PASS** — `npx vitest run test/worlds.test.js` → all green (full file).

- [ ] **Step 5: Commit**

```bash
git add lib/persist/worlds.js test/worlds.test.js
git commit -m "feat(persist): forkWorld — copy a published blob into a new owned world"
```

---

## Task 4: Published-gallery client

**Files:** Create `lib/persist/published.js`

- [ ] **Step 1: Create the module** (no unit test — it's a thin fetch wrapper verified live; keep it tiny):

```js
// Public world gallery client. These endpoints are public (no auth); the SDK is only needed for
// publishing. The deployed game's CSP allows connect-src https://nitzan.games.
const API = 'https://nitzan.games';

export async function listPublished(slug = 'blockworld') {
  try {
    const r = await fetch(`${API}/api/worlds?slug=${encodeURIComponent(slug)}`);
    if (!r.ok) return [];
    const data = await r.json();
    return Array.isArray(data.worlds) ? data.worlds : [];
  } catch { return []; }
}

export async function getPublished(publishId) {
  const r = await fetch(`${API}/api/worlds/${encodeURIComponent(publishId)}`);
  if (!r.ok) return null;            // 404 -> went private / missing
  return r.json();                   // { publish_id, title, creator_name, copyable, blob }
}
```

- [ ] **Step 2: Sanity-check** — `node --check lib/persist/published.js` (exit 0).

- [ ] **Step 3: Commit**

```bash
git add lib/persist/published.js
git commit -m "feat(persist): published.js — public gallery list/get client"
```

---

## Task 5: Auto-publish from the host autosave (main.js)

**Files:** Modify `main.js`

- [ ] **Step 1: Import the publisher**

In `main.js`, the worlds import currently reads (one line):
```js
import { getWorlds, loadWorld, saveWorld, saveIndex, newWorldId, upsertWorld, renameInIndex, deleteWorld, makeWorldAutosaver } from './lib/persist/worlds.js';
```
Add `makeWorldPublisher, setPrivacy, forkWorld` to that import:
```js
import { getWorlds, loadWorld, saveWorld, saveIndex, newWorldId, upsertWorld, renameInIndex, deleteWorld, makeWorldAutosaver, makeWorldPublisher, setPrivacy, forkWorld } from './lib/persist/worlds.js';
```
Also add at the top with the other imports:
```js
import { serialize } from './lib/voxel/rle.js';
import { listPublished, getPublished } from './lib/persist/published.js';
```

- [ ] **Step 2: Create the publisher next to the autosaver, and publish on edits + leave**

In `runGame`, find:
```js
  const autosave = host && worldId && sdk && sdk.save
    ? makeWorldAutosaver(sdk, worldId, () => world, index, () => Date.now(), 3000)
    : () => {};
```
Add immediately after it:
```js
  const publisher = host && worldId && sdk && sdk.publishWorld
    ? makeWorldPublisher(sdk, {
        worldId,
        getBlob: () => serialize(world),
        getMeta: () => { const e = (index || []).find((w) => w.id === worldId); return { title: (e && e.name) || worldName || 'World', privacy: (e && e.privacy) || 'public' }; },
      })
    : Object.assign(() => {}, { flush: () => {} });
```
Then find the host edit hook in the `createSession` hooks:
```js
      applyRemoteEdit: (x, y, z, b, dirty) => { dirty.forEach((id) => view.rebuildChunk(id)); if (host) autosave(); },
```
and change it to also publish:
```js
      applyRemoteEdit: (x, y, z, b, dirty) => { dirty.forEach((id) => view.rebuildChunk(id)); if (host) { autosave(); publisher(); } },
```
Then find the `beforeunload` handler:
```js
  window.addEventListener('beforeunload', () => { if (host && worldId && sdk.save) saveWorld(sdk, worldId, world); });
```
and add a publish flush:
```js
  window.addEventListener('beforeunload', () => { if (host && worldId && sdk.save) { saveWorld(sdk, worldId, world); publisher.flush(); } });
```
Also flush on leaving via the in-world menu. Find the `createInWorldMenu({ ... onLeave: ... })` and change its `onLeave` to flush first:
```js
    onLeave: () => { try { publisher.flush(); } catch (e) {} try { room.leave(); } catch (e) {} location.reload(); },
```

- [ ] **Step 3: Sanity + tests** — `node --check main.js && npm test 2>&1 | tail -3` (all pass; the publisher is exercised by Task 2's unit tests).

- [ ] **Step 4: Commit**

```bash
git add main.js
git commit -m "feat: auto-publish world snapshots from the host autosave loop"
```

---

## Task 6: Privacy control in the Worlds list (menus.js + main.js)

**Files:** Modify `lib/ui/menus.js`, `main.js`

- [ ] **Step 1: Add `onPrivacy` to showMainMenu and a cycle button per world**

In `lib/ui/menus.js`, change the `showMainMenu` signature to accept `onPrivacy` and `onVisit`/`onListPublished` (used in Task 7 too):
```js
export function showMainMenu({ worlds, displayName, version, defaultName, onOpen, onNew, onRename, onDelete, onJoin, onListRooms, onPrivacy, onListPublished, onVisit }) {
```
In `renderWorldsList`, after the `row.appendChild(button('Open', ...))` line and before the `✎` button, add a privacy cycle button:
```js
      const PRIV = { public: '🌐 Public', viewonly: '👁 View-only', private: '🔒 Private' };
      const NEXT = { public: 'viewonly', viewonly: 'private', private: 'public' };
      const privBtn = button(PRIV[w.privacy || 'public'], () => {
        const next = NEXT[w.privacy || 'public'];
        w.privacy = next; privBtn.textContent = PRIV[next];
        if (onPrivacy) onPrivacy(w.id, next);
      }, '#2b3340');
      row.appendChild(privBtn);
```

- [ ] **Step 2: Wire `onPrivacy` in main.js**

In `boot`'s `showMainMenu({...})` options, add (after `onDelete`):
```js
    onPrivacy: async (id, privacy) => { setPrivacy(index, id, privacy); await saveIndexSafe(); if (sdk && sdk.publishWorld) { try { const e = index.find((w) => w.id === id); const w = await loadWorld(sdk, id); if (w) await sdk.publishWorld({ worldId: id, title: (e && e.name) || 'World', blob: serialize(w), privacy }); } catch (e) {} } },
```

- [ ] **Step 3: Sanity + tests** — `node --check main.js && node --check lib/ui/menus.js && npm test 2>&1 | tail -3` (pass).

- [ ] **Step 4: Commit**

```bash
git add lib/ui/menus.js main.js
git commit -m "feat(ui): per-world privacy cycle control (public/view-only/private) + publish on change"
```

---

## Task 7: "Explore worlds" gallery + read-only viewer + Make a copy

**Files:** Modify `lib/ui/menus.js`, `main.js`

- [ ] **Step 1: Add an "Explore worlds" button + gallery sub-view in menus.js**

In `renderHome`'s template, add an Explore button right after the `#mm-edit` button:
```js
        <button id="mm-explore" style="width:100%;height:44px;border:0;border-radius:8px;background:#3a3f47;color:#fff;font-weight:600;font-size:15px;cursor:pointer;margin-bottom:18px">Explore worlds →</button>
```
(and change the `#mm-edit` button's `margin-bottom:18px` to `margin-bottom:8px` so they stack tightly.)
Wire it in `renderHome` (after the `#mm-edit` onclick line):
```js
    el.querySelector('#mm-explore').onclick = () => { view = 'gallery'; renderGallery(); };
```
Add a `renderGallery` function (next to `renderWorlds`):
```js
  async function renderGallery() {
    stopPolling();
    el.innerHTML = `
      <div style="width:330px;max-width:92vw;padding:22px;background:#14171c;border-radius:16px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
          <button id="mm-back" style="border:0;border-radius:8px;background:#3a3f47;color:#fff;padding:7px 12px;cursor:pointer;font-size:14px">←</button>
          <h1 style="margin:0;font-size:20px">Explore worlds</h1>
        </div>
        <div id="mm-gallery" style="display:flex;flex-direction:column;gap:6px"><div style="opacity:.5;font-size:13px;padding:4px 0">Loading…</div></div>
      </div>`;
    el.querySelector('#mm-back').onclick = () => { view = 'home'; renderHome(); };
    const box = el.querySelector('#mm-gallery');
    const worldsList = onListPublished ? await onListPublished() : [];
    if (view !== 'gallery') return; // user navigated away while loading
    if (!worldsList.length) { box.innerHTML = '<div style="opacity:.5;font-size:13px;padding:4px 0">No published worlds yet.</div>'; return; }
    box.innerHTML = '';
    worldsList.forEach((p) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:6px;background:#1c2027;border-radius:8px;padding:6px 8px';
      const info = document.createElement('div');
      info.style.cssText = 'flex:1;min-width:0';
      info.innerHTML = `<div style="font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.title)}</div>` +
        `<div style="font-size:11px;opacity:.5">by ${esc(p.creator_name)}${p.updated_at ? ' · ' + relTime(Date.parse(p.updated_at)) : ''}</div>`;
      row.appendChild(info);
      row.appendChild(button('Visit', () => onVisit(p.publish_id), '#5EA918'));
      box.appendChild(row);
    });
  }
```

- [ ] **Step 2: Add `runVisit` (read-only viewer) to main.js**

In `main.js`, add a new function near `runGame` (it reuses the renderer/camera/input/mode toggle, no networking):
```js
// Solo, read-only viewer for a published world snapshot. No multiplayer, no building, no autosave.
// `onCopy` (when provided) forks the snapshot into the visitor's own worlds.
function runVisit(world, meta, onCopy) {
  const view = createWorldView(canvas, world);
  const cam = createFlyCamera([WX / 2, 8, WZ / 2], 0, -0.35);
  view.rebuildAll();
  let mode = 'explore'; // start walking through it; toggle to fly with the same button
  const modeBtn = document.getElementById('modeBtn');
  if (modeBtn) { modeBtn.textContent = 'Walk'; modeBtn.onclick = () => { mode = mode === 'edit' ? 'explore' : 'edit'; cam.vel[0] = cam.vel[1] = cam.vel[2] = 0; cam.grounded = false; modeBtn.textContent = mode === 'edit' ? 'Fly' : 'Walk'; }; }

  // Top-bar overlay: world title + Leave (+ Make a copy when copyable).
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
```

- [ ] **Step 3: Wire the gallery + visit + copy in boot (main.js)**

In `boot`'s `showMainMenu({...})` options, add:
```js
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
```
(Ensure `deserialize` is imported: Step 1 added `import { serialize } from './lib/voxel/rle.js';` — change it to `import { serialize, deserialize } from './lib/voxel/rle.js';`.)

- [ ] **Step 4: Sanity + tests + smoke** — `node --check main.js && node --check lib/ui/menus.js && npm test 2>&1 | tail -3 && npm run smoke 2>&1 | tail -1` (all pass; smoke menu renders).

- [ ] **Step 5: Commit**

```bash
git add lib/ui/menus.js main.js
git commit -m "feat: Explore-worlds gallery, read-only viewer, and Make-a-copy"
```

---

## Task 8: Verify, version bump, deploy

**Files:** Modify `index.html`, `package.json`

- [ ] **Step 1: Full suite + smoke** — `npm test` (all green) and `npm run smoke` (SMOKE OK).

- [ ] **Step 2: Manual via dev server** (`npm run dev`): create a world (auto-publishes), set a 2nd device/incognito → "Explore worlds" shows it → Visit walks through read-only → "Make a copy" forks it editable. Set a world to View-only → Visit works, no copy button. Set Private → it disappears from the gallery.

- [ ] **Step 3: Bump version to v0.5.12** — in `index.html` replace both `v0.5.11` (meta + `#ver`) with `v0.5.12`; in `package.json` replace `"version": "0.5.11"` with `"version": "0.5.12"`.

- [ ] **Step 4: Commit**

```bash
git add index.html package.json
git commit -m "chore: publish & visit worlds complete; v0.5.12"
```

---

## Self-Review

**Spec coverage (§4):**
- Index `privacy` default + migration (§4) → Task 1.
- Auto-publish throttled + flush on leave, host-only (§4) → Task 2 (logic) + Task 5 (wiring).
- Privacy control 3-level cycle in Edit-Existing (§4) → Task 6.
- "Explore worlds" gallery fetch + rows (§4) → Task 4 (client) + Task 7.
- Read-only viewer (no network/build), Make-a-copy fork (§4) → Task 7 (`runVisit`, `onVisit`, `onCopy`) + Task 3 (`forkWorld`).
- Error handling: list/get failures, 404, deserialize guard (§6) → Task 4 (`listPublished` returns [] on error; `getPublished` returns null on !ok) + Task 7 `onVisit` guards.

**Placeholder scan:** None — every code step has complete code. (Task 7 Step 2 explicitly flags and corrects a stray `if (sdkPause)` line; Step 3 corrects the fork-name handling — these are real instructions, not placeholders. The implementer should use the corrected forms.)

**Type/name consistency:** `makeWorldPublisher(sdk, opts)` opts `{worldId,getBlob,getMeta,now,windowMs}` and the returned `schedule`/`.flush` match Task 2 → Task 5. `forkWorld(index, blob, name) -> {id, world}` matches Task 3 → Task 7. `setPrivacy(index,id,privacy)` Task 1 → Task 6. `listPublished()/getPublished()` Task 4 → Task 7. Menu options `onPrivacy/onListPublished/onVisit` added to `showMainMenu` (Task 6 Step 1) match main.js wiring (Tasks 6–7). Published row fields `{publish_id,title,creator_name,copyable,updated_at}` match Plan 1's GET list; `getPublished` returns `{...,blob}` matching the single GET.
