# Public Worlds + Restructured Main Menu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every hosted world public and discoverable, and restructure the main menu into Create New / Edit Existing / Join-a-live-world, while keeping the existing view-only-by-default permission model.

**Architecture:** Flip `createRoom` to `visibility:'public'` so worlds appear in `PlaySDK.multiplayer.listRooms()`. The main-menu overlay (`showMainMenu`) gets a two-view layout (home + saved-worlds sub-view) and polls `listRooms()` to show joinable rooms (code + player count only — the SDK exposes no room name). The host now sends its real world name in the existing `WELCOME` message so a joiner's in-world menu can show which world they're in.

**Tech Stack:** Vanilla ES modules, three.js (unchanged here), PlaySDK multiplayer relay, Vitest for the `session.js` unit test. Menus are plain DOM (no unit tests — verified via the dev server).

**Spec:** `docs/superpowers/specs/2026-06-15-blockworld-public-worlds-menu-design.md`

---

## File Structure

- `lib/net/session.js` — **modify.** Capture the `WELCOME` world name, expose a `worldName()` getter, fire an optional `onWelcome(name)` hook. (Unit-tested.)
- `test/session.test.js` — **modify.** Add a test for the WELCOME-name capture.
- `lib/ui/menus.js` — **rewrite both exports.** `showMainMenu` gets the two-view layout + live room list + polling; `createInWorldMenu` shows `In: <world name>` for visitors. (DOM — manual verification.)
- `main.js` — **modify.** `visibility:'public'`, thread the real world name into `runGame`/session, wire `onListRooms` + `defaultName`, add a `defaultWorldName(index)` helper, expose `worldName` to the in-world menu state.
- `index.html`, `package.json` — **modify.** Version bump to `v0.5.0`.

No platform-repo, persistence, rendering, or permission-logic changes.

---

## Task 1: session.js — capture the world name from WELCOME

**Files:**
- Modify: `lib/net/session.js`
- Test: `test/session.test.js`

- [ ] **Step 1: Write the failing test**

Add this `it(...)` block inside the `describe('session', ...)` in `test/session.test.js`, after the existing `'streams the world to a joining visitor'` test:

```js
  it('a joining visitor learns the world name from WELCOME', () => {
    const net = makeNetwork();
    const hw = createWorld(); fillFloor(hw, 8);
    const host = createSession({ transport: net.transportFor('host', true), getWorld: () => hw, ownerId: 'host',
      hooks: noopHooks({ worldName: 'Castle' }) });
    let seen = null;
    const vis = createSession({ transport: net.transportFor('vis', false), getWorld: () => null, ownerId: 'host',
      hooks: noopHooks({ onWelcome: (n) => { seen = n; } }) });
    net.join('host', { userId: 'vis', name: 'Vee' });
    expect(seen).toBe('Castle');
    expect(vis.worldName()).toBe('Castle');
    expect(host.worldName()).toBe('Castle');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/session.test.js -t "learns the world name"`
Expected: FAIL — `vis.worldName is not a function` (the getter does not exist yet).

- [ ] **Step 3: Implement the WELCOME capture in `lib/net/session.js`**

In the `// hooks: {` doc comment block (around lines 6–15), add one line documenting the new hook, after the `onPermChange` line:

```js
//   onWelcome(worldName)          visitor: received the host's world name (header display)
```

Change the state declaration. Replace:

```js
  let myCanEdit = isHost;
```

with:

```js
  let myCanEdit = isHost;
  let joinedWorldName = null; // visitor: world name learned from WELCOME
```

Replace the WELCOME case. Replace:

```js
      case T.WELCOME: break; // meta only; world arrives via SNAPSHOT
```

with:

```js
      case T.WELCOME: // meta only; world arrives via SNAPSHOT
        joinedWorldName = p.name || null;
        if (hooks.onWelcome) hooks.onWelcome(p.name);
        break;
```

Add the getter to the returned object. Replace:

```js
  return {
    isHost,
    canEditLocal() { return isHost || myCanEdit; },
```

with:

```js
  return {
    isHost,
    worldName() { return isHost ? hooks.worldName : joinedWorldName; },
    canEditLocal() { return isHost || myCanEdit; },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/session.test.js`
Expected: PASS — all 5 session tests green (4 existing + the new one).

- [ ] **Step 5: Commit**

```bash
git add lib/net/session.js test/session.test.js
git commit -m "feat(net): capture world name from WELCOME; session.worldName() + onWelcome hook"
```

---

## Task 2: menus.js — restructured main menu + visitor world-name header

**Files:**
- Modify (full rewrite of both exports): `lib/ui/menus.js`

This file is DOM-only with no unit tests; verify via the dev server in Task 4.

- [ ] **Step 1: Replace the entire contents of `lib/ui/menus.js` with the following**

```js
// Minimal DOM menus. showMainMenu shows a full-screen overlay with a Home view
// (Create New / Edit Existing / Join a live world) and a saved-worlds sub-view.
// createInWorldMenu builds the panel toggled by the ☰ button.
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function relTime(ts) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60); if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

// worlds: [{id,name,updatedAt}]. Options:
//   displayName, defaultName(string used to prefill Create),
//   onOpen(id), onNew(name), onRename(id,name), onDelete(id), onJoin(code),
//   onListRooms() -> Promise<[{code,playerCount,maxPlayers}]>.
// Returns { setStatus, setWorlds, close }.
export function showMainMenu({ worlds, displayName, defaultName, onOpen, onNew, onRename, onDelete, onJoin, onListRooms }) {
  let list = worlds.slice();
  let rooms = [];
  let view = 'home';           // 'home' | 'worlds'
  let pollTimer = null;
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

  function setStatus(t) { const s = el.querySelector('#mm-status'); if (s) s.textContent = t; }

  // --- live rooms polling (Home view only) ---
  function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
  function startPolling() {
    stopPolling();
    refreshRooms();
    pollTimer = setInterval(refreshRooms, 4000);
  }
  async function refreshRooms() {
    if (!onListRooms) { rooms = []; if (view === 'home') renderRooms(); return; }
    try { const r = await onListRooms(); rooms = Array.isArray(r) ? r : []; }
    catch { rooms = []; }
    if (view === 'home') renderRooms();
  }
  function renderRooms() {
    const box = el.querySelector('#mm-rooms');
    if (!box) return;
    if (!rooms.length) {
      box.innerHTML = '<div style="opacity:.5;font-size:13px;padding:4px 0">No live worlds right now.</div>';
      return;
    }
    box.innerHTML = '';
    rooms.forEach((r) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:6px;background:#1c2027;border-radius:8px;padding:6px 8px';
      const info = document.createElement('div');
      info.style.cssText = 'flex:1;min-width:0';
      info.innerHTML = `<div style="font-size:15px">Room <b style="letter-spacing:2px">${esc(r.code)}</b></div>` +
        `<div style="font-size:11px;opacity:.5">${r.playerCount}/${r.maxPlayers} here</div>`;
      row.appendChild(info);
      row.appendChild(button('Join', () => onJoin(r.code), '#3C44AA'));
      box.appendChild(row);
    });
  }

  function renderHome() {
    stopPolling();
    el.innerHTML = `
      <div style="width:330px;max-width:92vw;padding:22px;background:#14171c;border-radius:16px">
        <h1 style="margin:0 0 2px;font-size:28px">BlockWorld</h1>
        <div style="opacity:.6;font-size:12px;margin-bottom:16px">${displayName ? 'Signed in as ' + esc(displayName) : 'Playing as guest'}</div>
        <button id="mm-create" style="width:100%;height:44px;border:0;border-radius:8px;background:#5EA918;color:#fff;font-weight:600;font-size:15px;cursor:pointer;margin-bottom:8px">+ Create New World</button>
        <div id="mm-create-form" style="display:none;gap:6px;margin-bottom:8px">
          <input id="mm-newname" style="flex:1;height:40px;border-radius:8px;border:2px solid #333;background:#1a1d23;color:#fff;padding:0 10px;font-size:14px">
          <button id="mm-create-go" style="height:40px;border:0;border-radius:8px;background:#5EA918;color:#fff;font-weight:600;padding:0 14px;cursor:pointer">Create</button>
          <button id="mm-create-cancel" style="height:40px;border:0;border-radius:8px;background:#3a3f47;color:#fff;padding:0 12px;cursor:pointer">✕</button>
        </div>
        <button id="mm-edit" style="width:100%;height:44px;border:0;border-radius:8px;background:#3a3f47;color:#fff;font-weight:600;font-size:15px;cursor:pointer;margin-bottom:18px">Edit Existing →</button>
        <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.6;margin-bottom:6px">Join a live world</div>
        <div id="mm-rooms" style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px"></div>
        <div style="text-align:center;opacity:.4;font-size:12px;margin-bottom:8px">— or enter a code —</div>
        <div style="display:flex;gap:6px">
          <input id="mm-code" placeholder="CODE" maxlength="6" style="flex:1;height:40px;text-align:center;text-transform:uppercase;border-radius:8px;border:2px solid #333;background:#1a1d23;color:#fff;font-size:16px">
          <button id="mm-join" style="height:40px;border:0;border-radius:8px;background:#3C44AA;color:#fff;font-weight:600;padding:0 14px;cursor:pointer">Join</button>
        </div>
        <div id="mm-status" style="height:16px;font-size:12px;color:#f8c627;margin-top:8px"></div>
      </div>`;

    const createBtn = el.querySelector('#mm-create');
    const form = el.querySelector('#mm-create-form');
    const nameInp = el.querySelector('#mm-newname');
    const closeForm = () => { form.style.display = 'none'; createBtn.style.display = 'block'; };
    createBtn.onclick = () => {
      form.style.display = 'flex'; createBtn.style.display = 'none';
      nameInp.value = defaultName || 'New World'; nameInp.focus(); nameInp.select();
    };
    el.querySelector('#mm-create-cancel').onclick = closeForm;
    const submitNew = () => { const n = nameInp.value.trim(); if (!n) { setStatus('Enter a world name'); nameInp.focus(); return; } onNew(n); };
    el.querySelector('#mm-create-go').onclick = submitNew;
    nameInp.onkeydown = (e) => { if (e.key === 'Enter') submitNew(); if (e.key === 'Escape') closeForm(); };
    el.querySelector('#mm-edit').onclick = () => { view = 'worlds'; renderWorlds(); };
    el.querySelector('#mm-join').onclick = () => {
      const c = el.querySelector('#mm-code').value.trim().toUpperCase();
      if (!c) { setStatus('Enter a code'); return; }
      onJoin(c);
    };

    renderRooms();
    startPolling();
  }

  function renderWorlds() {
    stopPolling();
    el.innerHTML = `
      <div style="width:330px;max-width:92vw;padding:22px;background:#14171c;border-radius:16px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
          <button id="mm-back" style="border:0;border-radius:8px;background:#3a3f47;color:#fff;padding:7px 12px;cursor:pointer;font-size:14px">←</button>
          <h1 style="margin:0;font-size:20px">Your Worlds</h1>
        </div>
        <div id="mm-worlds" style="display:flex;flex-direction:column;gap:6px"></div>
        <div id="mm-status" style="height:16px;font-size:12px;color:#f8c627;margin-top:8px"></div>
      </div>`;
    el.querySelector('#mm-back').onclick = () => { view = 'home'; renderHome(); };
    renderWorldsList();
  }

  function renderWorldsList() {
    const box = el.querySelector('#mm-worlds');
    if (!box) return;
    box.innerHTML = '';
    if (!list.length) {
      box.innerHTML = '<div style="opacity:.5;font-size:13px;padding:4px 0">No worlds yet — go back and create one.</div>';
      return;
    }
    list.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).forEach((w) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:6px;background:#1c2027;border-radius:8px;padding:6px 8px';
      const info = document.createElement('div');
      info.style.cssText = 'flex:1;min-width:0';
      const name = document.createElement('div');
      name.textContent = w.name; name.style.cssText = 'font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      const time = document.createElement('div');
      time.textContent = w.updatedAt ? 'edited ' + relTime(w.updatedAt) : '';
      time.style.cssText = 'font-size:11px;opacity:.5';
      info.append(name, time);
      row.appendChild(info);
      row.appendChild(button('Open', () => onOpen(w.id), '#5EA918'));
      row.appendChild(button('✎', () => startRename(row, info, w)));
      row.appendChild(button('🗑', () => startDelete(row, w), '#7a2620'));
      box.appendChild(row);
    });
  }

  function startRename(row, nameSpan, w) {
    const inp = document.createElement('input');
    inp.value = w.name;
    inp.style.cssText = 'flex:1;height:30px;border-radius:6px;border:2px solid #4c8bf5;background:#11141a;color:#fff;padding:0 8px;font-size:14px';
    row.replaceChild(inp, nameSpan); inp.focus(); inp.select();
    const commit = () => { const n = inp.value.trim(); if (n && n !== w.name) onRename(w.id, n); else renderWorldsList(); };
    inp.onkeydown = (e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') renderWorldsList(); };
    inp.onblur = commit;
  }

  function startDelete(row, w) {
    row.innerHTML = '';
    const q = document.createElement('span');
    q.textContent = `Delete "${w.name}"?`; q.style.cssText = 'flex:1;font-size:14px';
    row.appendChild(q);
    row.appendChild(button('Delete', () => onDelete(w.id), '#b02e26'));
    row.appendChild(button('Cancel', () => renderWorldsList(), '#3a3f47'));
  }

  renderHome();
  return {
    setStatus,
    setWorlds: (next) => { list = next.slice(); if (view === 'worlds') renderWorldsList(); },
    close: () => { stopPolling(); el.remove(); },
  };
}

// In-world panel toggled by the ☰ button. getState() returns
// { isHost, code, worldName, players:[{userId,name,canEdit}] }. onToggle(userId,canEdit), onLeave().
export function createInWorldMenu({ getState, onToggle, onLeave }) {
  let el = null;
  function render() {
    const s = getState();
    el.innerHTML = `
      <div style="font-weight:700;font-size:16px;margin-bottom:8px">Menu</div>
      ${s.isHost ? `<div style="margin-bottom:8px">Share code: <b style="font-size:20px;letter-spacing:2px">${s.code || '…'}</b></div>` : ''}
      ${!s.isHost && s.worldName ? `<div style="margin-bottom:8px;opacity:.85">In: <b>${esc(s.worldName)}</b></div>` : ''}
      <div style="font-size:13px;opacity:.7;margin-bottom:4px">Players</div>
      <div id="iw-players"></div>
      <button id="iw-leave" style="margin-top:12px;width:100%;height:40px;border:0;border-radius:8px;background:#b02e26;color:#fff;cursor:pointer">Leave</button>`;
    const list = el.querySelector('#iw-players');
    if (!s.players.length) list.innerHTML = '<div style="opacity:.5;font-size:13px">No one else here yet</div>';
    s.players.forEach((p) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:4px 0';
      row.innerHTML = `<span>${p.name}</span>`;
      if (s.isHost) {
        const btn = document.createElement('button');
        btn.textContent = p.canEdit ? 'Can build ✓' : 'View only';
        btn.style.cssText = `border:0;border-radius:6px;padding:4px 8px;cursor:pointer;background:${p.canEdit ? '#5EA918' : '#444'};color:#fff`;
        btn.onclick = () => onToggle(p.userId, !p.canEdit);
        row.appendChild(btn);
      }
      list.appendChild(row);
    });
    el.querySelector('#iw-leave').onclick = onLeave;
  }
  return {
    toggle() {
      if (el) { el.remove(); el = null; return; }
      el = document.createElement('div');
      el.style.cssText = 'position:absolute;top:48px;left:12px;z-index:11;width:260px;background:rgba(20,23,28,.96);color:#fff;border-radius:12px;padding:14px;font-family:system-ui,sans-serif;pointer-events:auto';
      document.body.appendChild(el); render();
    },
    refresh() { if (el) render(); },
    close() { if (el) { el.remove(); el = null; } },
  };
}
```

- [ ] **Step 2: Sanity-check the file parses**

Run: `node --check lib/ui/menus.js`
Expected: no output (exit 0). If it errors, fix the syntax before continuing.

- [ ] **Step 3: Commit**

```bash
git add lib/ui/menus.js
git commit -m "feat(ui): main menu Home/Worlds views + live rooms list; visitor world-name header"
```

---

## Task 3: main.js — public hosting, room listing, world-name plumbing

**Files:**
- Modify: `main.js`

- [ ] **Step 1: Add the `defaultWorldName` helper**

In `main.js`, directly after the `showLoading` function (it ends at line 33 with `}`), insert:

```js
function defaultWorldName(index) {
  const names = new Set((index || []).map((w) => w.name));
  let n = (index ? index.length : 0) + 1;
  while (names.has('World ' + n)) n++;
  return 'World ' + n;
}
```

- [ ] **Step 2: Wire `defaultName` and `onListRooms` into the menu**

In `boot()`, the `showMainMenu({ ... })` call currently starts:

```js
  const menu = showMainMenu({
    worlds: index,
    displayName,
    onOpen: (id) => startHost(id),
```

Replace those lines with:

```js
  const menu = showMainMenu({
    worlds: index,
    displayName,
    defaultName: defaultWorldName(index),
    onListRooms: () => (sdk && sdk.multiplayer && sdk.multiplayer.listRooms ? sdk.multiplayer.listRooms() : Promise.resolve([])),
    onOpen: (id) => startHost(id),
```

- [ ] **Step 3: Pass the world name through `onNew`**

In the same `showMainMenu` options, the `onNew` handler ends with `startHost(id, w);`. Replace:

```js
    onNew: async (name) => {
      const id = newWorldId(index);
      const w = createWorld(); fillFloor(w, 8);
      if (sdk && sdk.save) { await saveWorld(sdk, id, w); upsertWorld(index, { id, name, updatedAt: Date.now() }); await saveIndexSafe(); }
      startHost(id, w);
    },
```

with:

```js
    onNew: async (name) => {
      const id = newWorldId(index);
      const w = createWorld(); fillFloor(w, 8);
      if (sdk && sdk.save) { await saveWorld(sdk, id, w); upsertWorld(index, { id, name, updatedAt: Date.now() }); await saveIndexSafe(); }
      startHost(id, w, name);
    },
```

- [ ] **Step 4: Make hosting public and resolve the world name**

Replace the entire `startHost` function:

```js
  async function startHost(worldId, preworld) {
    let room;
    try { room = await sdk.multiplayer.createRoom({ maxPlayers: 8, visibility: 'private' }); }
    catch (e) { menu.setStatus('Could not host: ' + (e && e.message ? e.message : 'try again')); return; }
    const transport = makePlayTransport(sdk, room, room.hostId);
    menu.close();
    runGame({ sdk, room, transport, ownerId: room.hostId, host: true, myName: displayName || 'Guest', worldId, preworld, index });
  }
```

with:

```js
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
```

- [ ] **Step 5: Accept `worldName` in `runGame` and feed the session**

Change the `runGame` signature. Replace:

```js
function runGame({ sdk, room, transport, ownerId, host, myName, worldId, preworld, index }) {
```

with:

```js
function runGame({ sdk, room, transport, ownerId, host, myName, worldId, preworld, index, worldName }) {
```

In the `createSession({ ... hooks: { ... } })` block, replace the hardcoded world name. Replace:

```js
      worldName: 'World',
      onSnapshot: (w) => { world = w; rebindWorld(); if (loadingEl) { loadingEl.remove(); loadingEl = null; } },
```

with:

```js
      worldName: worldName || 'World',
      onWelcome: () => inWorld.refresh(),
      onSnapshot: (w) => { world = w; rebindWorld(); if (loadingEl) { loadingEl.remove(); loadingEl = null; } },
```

- [ ] **Step 6: Expose the world name to the in-world menu**

In the `createInWorldMenu({ getState: ... })` call, replace:

```js
    getState: () => ({ isHost: host, code: room.code, players: session.players() }),
```

with:

```js
    getState: () => ({ isHost: host, code: room.code, worldName: session.worldName(), players: session.players() }),
```

- [ ] **Step 7: Sanity-check the file parses**

Run: `node --check main.js`
Expected: no output (exit 0).

- [ ] **Step 8: Commit**

```bash
git add main.js
git commit -m "feat: host worlds publicly; list live rooms; thread real world name into session/menu"
```

---

## Task 4: Verify, version bump, and final commit

**Files:**
- Modify: `index.html`, `package.json`

- [ ] **Step 1: Run the full unit-test suite**

Run: `npm test`
Expected: PASS — all suites green, including the 5 `session` tests.

- [ ] **Step 2: Manual smoke test via the dev server**

Run: `npm run dev` and open the printed URL in a browser. Verify, in order:

1. **Home view** shows `+ Create New World`, `Edit Existing →`, and a `Join a live world` section.
2. **Create:** click `+ Create New World` → an input appears pre-filled with a default like `World 1` → edit/accept → click Create → you drop into a world (you are host; ☰ shows a share code).
3. **Edit Existing:** back on Home, click `Edit Existing →` → saved-worlds list with Open / ✎ / 🗑 and a `←` back button → Open hosts the world; `←` returns Home.
4. **Live list (two clients):** with one tab hosting, open a second tab → its Home `Join a live world` list shows `Room <CODE> · 1/8` within ~4s → click Join → you enter view-only (cannot place/remove blocks).
5. **Code join:** the `CODE` input + Join still works with the host's share code.
6. **World name after join:** as the joiner, open ☰ → header shows `In: <world name>`.
7. **Grant edit:** as host, open ☰ → toggle the visitor to `Can build ✓` → visitor can now place blocks.

Stop the dev server (Ctrl-C) when done.

- [ ] **Step 3: Bump the version to v0.5.0**

In `index.html`, replace `<meta name="game-version" content="v0.4.1">` with `<meta name="game-version" content="v0.5.0">`, and replace `<span id="ver" style="opacity:.8;font-size:13px">v0.4.1</span>` with `<span id="ver" style="opacity:.8;font-size:13px">v0.5.0</span>`.

In `package.json`, replace `"version": "0.4.1",` with `"version": "0.5.0",`.

- [ ] **Step 4: Commit**

```bash
git add index.html package.json
git commit -m "chore: public worlds + restructured menu complete; v0.5.0"
```

---

## Self-Review

**Spec coverage:**
- Public by default (spec §1, §3) → Task 3 Step 4 (`visibility:'public'`).
- Discovery / live list (§2, §4, §5.1) → Task 2 (`onListRooms`/polling/`renderRooms`) + Task 3 Step 2.
- Create New with default-filled name (§3, §5.1) → Task 2 (`mm-create` form, `defaultName`) + Task 3 Steps 1–3.
- Edit Existing sub-view reusing saved list (§3, §5.1) → Task 2 (`renderWorlds`/`renderWorldsList`).
- View-only-by-default + per-user grant (§1, §3) → unchanged; verified in Task 4 Step 2 (#4, #7). No code change needed.
- World name after join (§3, §5.2, §5.4, §6) → Task 1 (session) + Task 2 (header) + Task 3 Steps 5–6.
- Guest/no-SDK fallback (§8) → Task 3 Step 2 (`onListRooms` resolves `[]`).
- Tests (§7) → Task 1 unit test; Task 4 manual smoke.

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows complete code.

**Type/name consistency:** `worldName()` getter (Task 1) is consumed by `getState` (Task 3 Step 6) and read by `createInWorldMenu` via `s.worldName` (Task 2). `onWelcome` defined as optional in session (Task 1) and provided in `runGame` (Task 3 Step 5). `onListRooms`/`defaultName`/`onNew(name)`/`startHost(id, preworld, nameHint)` signatures match across Task 2 and Task 3. Room entry fields (`code`, `playerCount`, `maxPlayers`) match the verified SDK shape.
