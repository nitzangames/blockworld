# BlockWorld Plan 2 — Multiplayer (Host-Authoritative) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a BlockWorld world live and joinable — the owner hosts their world and shares a code; visitors join, see the world streamed in, build together in real time as blocky avatars with names, with the owner granting build rights per person.

**Architecture:** Host-authoritative over the PlaySDK multiplayer relay (a message bus, no server state). The host holds the authoritative voxel store and is the sole writer to the cloud. All edits flow through the host: a visitor sends an `edit-req`, the host validates permission + bounds and broadcasts the authoritative `edit`; everyone (including the requester) applies on the echo. The networking core (`session.js`) is written against an **injectable transport interface**, so host+visitor handshake and edit-sync are unit-tested with a fake in-memory transport. A thin `play-transport.js` adapts `PlaySDK.multiplayer` to that interface in production.

**Tech Stack:** Builds on Plan 1 (vanilla ES modules, three.js r128 global, vitest, dev server :8093). Uses `PlaySDK.multiplayer` (`createRoom/joinRoom`, `room.send(payload, to?)`, `on('game'|'playerJoined'|'playerLeft'|'disconnected')`).

This is Plan 2. It implements spec §4 (roles/sync) and §5 (protocol), avatars, per-person grants
(§3/§8 Players panel), and the host/join menus — scoped to **networking only**: one world per user
(host your existing `world:current`), join others by code. The multi-world "My Worlds" list/rename is
deferred to a later plan. Spec: `docs/superpowers/specs/2026-06-14-blockworld-multiplayer-builder-design.md`.

**Decisions for this plan:**
- **Avatars:** blocky humanoid (head + body box) tinted a per-player color, with a floating name sprite, interpolated between position updates.
- **Edit model:** visitors are **not optimistic** — they send `edit-req` and apply only when the host's authoritative `edit` echoes back (no rollback logic needed; ~1 RTT latency is fine for building). The host applies its own edits immediately and broadcasts them.
- **Session start:** a **main menu** on boot — "Play My World" (become host) or "Join by Code" (visitor). Always-multiplayer = the host always opens a room; solo play is just a room with nobody else in it.
- **Carry-overs folded in:** the mobile look-drag device verification and the `dirtyChunksFor` `cy`-clamp fix (Task 10).

---

## File Structure (new/changed)

```
lib/net/
  protocol.js        pure: message-type constants, snapshot chunking + reassembly
  permissions.js     pure: per-player build-rights table (owner always allowed)
  session.js         host/visitor logic over an injected transport (pure-ish, testable)
  play-transport.js  adapts PlaySDK.multiplayer to the transport interface (browser)
lib/player/
  player-color.js    pure: deterministic per-userId color
lib/render/
  avatars.js         three.js blocky-humanoid avatars + name sprites + interpolation (browser)
lib/ui/
  menus.js           main menu (host/join) + in-world menu (share code, players panel) (browser)
main.js              CHANGED: menu → session wiring, edit routing, pos loop, avatar updates
test/
  protocol.test.js  permissions.test.js  player-color.test.js  session.test.js
```

---

## Task 1: Protocol (message types + snapshot chunking)

**Files:** create `lib/net/protocol.js`, `test/protocol.test.js`

- [ ] **Step 1: Write `test/protocol.test.js`**

```js
import { describe, it, expect } from 'vitest';
import { T, chunkSnapshot, SnapshotReassembler } from '../lib/net/protocol.js';

describe('protocol', () => {
  it('defines short distinct message-type tags', () => {
    const vals = Object.values(T);
    expect(new Set(vals).size).toBe(vals.length);
    expect(T.SNAPSHOT).toBeDefined();
    expect(T.EDIT).toBeDefined();
  });
  it('chunks a blob into pieces of seq/total/data and a tiny blob is one piece', () => {
    expect(chunkSnapshot('abcd', 100)).toEqual([{ seq: 0, total: 1, data: 'abcd' }]);
    const pieces = chunkSnapshot('abcdefg', 3);
    expect(pieces.map((p) => p.data)).toEqual(['abc', 'def', 'g']);
    expect(pieces.every((p) => p.total === 3)).toBe(true);
  });
  it('reassembles pieces (in any order) back into the original blob', () => {
    const pieces = chunkSnapshot('hello world snapshot', 4);
    const r = new SnapshotReassembler();
    let done = null;
    for (const p of [...pieces].reverse()) done = r.add(p) || done;
    expect(done).toBe('hello world snapshot');
  });
  it('reassembler returns null until all pieces are in', () => {
    const r = new SnapshotReassembler();
    expect(r.add({ seq: 0, total: 2, data: 'aa' })).toBeNull();
    expect(r.add({ seq: 1, total: 2, data: 'bb' })).toBe('aabb');
  });
});
```

- [ ] **Step 2: Run `npm test -- protocol`, confirm FAIL.**

- [ ] **Step 3: Implement `lib/net/protocol.js`**

```js
// Message tags kept to single chars to keep relay payloads small.
export const T = {
  WELCOME: 'w',   // host -> joining visitor: world meta
  SNAPSHOT: 's',  // host -> joining visitor: one RLE-blob piece {seq,total,data}
  EDIT_REQ: 'q',  // visitor -> host: requested block change {x,y,z,b}
  EDIT: 'e',      // host -> all: authoritative block change {x,y,z,b}
  POS: 'p',       // any -> all: {x,y,z,yaw,pitch}
  PERM: 'm',      // host -> all: {userId, canEdit}
  BYE: 'b',       // leaving -> all
};

const MAX_PIECE = 12000; // base64 chars per snapshot message (safely under the relay limit)

export function chunkSnapshot(blob, maxLen = MAX_PIECE) {
  const total = Math.max(1, Math.ceil(blob.length / maxLen));
  const pieces = [];
  for (let i = 0; i < total; i++) {
    pieces.push({ seq: i, total, data: blob.slice(i * maxLen, (i + 1) * maxLen) });
  }
  return pieces;
}

export class SnapshotReassembler {
  constructor() { this.reset(); }
  reset() { this.parts = []; this.total = -1; this.got = 0; }
  // Returns the full blob string once every piece has arrived, else null.
  add(p) {
    if (this.total === -1) { this.total = p.total; this.parts = new Array(p.total); this.got = 0; }
    if (this.parts[p.seq] === undefined) { this.parts[p.seq] = p.data; this.got++; }
    if (this.got === this.total) { const s = this.parts.join(''); this.reset(); return s; }
    return null;
  }
}
```

- [ ] **Step 4: Run `npm test -- protocol`, confirm PASS (4 tests).**
- [ ] **Step 5: Commit** `git add lib/net/protocol.js test/protocol.test.js && git commit -m "feat(net): message types + snapshot chunking/reassembly"`

---

## Task 2: Permissions table

**Files:** create `lib/net/permissions.js`, `test/permissions.test.js`

- [ ] **Step 1: Write `test/permissions.test.js`**

```js
import { describe, it, expect } from 'vitest';
import { createPermissions } from '../lib/net/permissions.js';

describe('permissions', () => {
  it('owner can always edit, even if never added', () => {
    const p = createPermissions('owner');
    expect(p.canEdit('owner')).toBe(true);
  });
  it('a visitor defaults to no edit until granted', () => {
    const p = createPermissions('owner');
    p.add('vis', 'Vee');
    expect(p.canEdit('vis')).toBe(false);
    p.set('vis', true);
    expect(p.canEdit('vis')).toBe(true);
    p.set('vis', false);
    expect(p.canEdit('vis')).toBe(false);
  });
  it('lists current players with name + canEdit, and forgets removed ones', () => {
    const p = createPermissions('owner');
    p.add('a', 'A'); p.add('b', 'B'); p.set('b', true);
    expect(p.list()).toEqual([
      { userId: 'a', name: 'A', canEdit: false },
      { userId: 'b', name: 'B', canEdit: true },
    ]);
    p.remove('a');
    expect(p.list().map((x) => x.userId)).toEqual(['b']);
  });
});
```

- [ ] **Step 2: Run `npm test -- permissions`, confirm FAIL.**

- [ ] **Step 3: Implement `lib/net/permissions.js`**

```js
// Tracks connected visitors and their build rights. The owner is always allowed and is not
// stored in the table.
export function createPermissions(ownerId) {
  const players = new Map(); // userId -> { name, canEdit }
  return {
    add(userId, name) { if (!players.has(userId)) players.set(userId, { name: name || 'Player', canEdit: false }); },
    remove(userId) { players.delete(userId); },
    set(userId, canEdit) { const p = players.get(userId); if (p) p.canEdit = !!canEdit; },
    canEdit(userId) {
      if (userId === ownerId) return true;
      const p = players.get(userId);
      return !!(p && p.canEdit);
    },
    list() { return [...players.entries()].map(([userId, p]) => ({ userId, name: p.name, canEdit: p.canEdit })); },
  };
}
```

- [ ] **Step 4: Run `npm test -- permissions`, confirm PASS (3 tests).**
- [ ] **Step 5: Commit** `git add lib/net/permissions.js test/permissions.test.js && git commit -m "feat(net): per-player build-rights table (owner always allowed)"`

---

## Task 3: Player color

**Files:** create `lib/player/player-color.js`, `test/player-color.test.js`

- [ ] **Step 1: Write `test/player-color.test.js`**

```js
import { describe, it, expect } from 'vitest';
import { playerColor } from '../lib/player/player-color.js';

describe('player color', () => {
  it('returns a stable #rrggbb for a given id', () => {
    const a = playerColor('user-123');
    expect(a).toMatch(/^#[0-9a-f]{6}$/);
    expect(playerColor('user-123')).toBe(a);
  });
  it('different ids usually differ', () => {
    expect(playerColor('aaa')).not.toBe(playerColor('zzz'));
  });
});
```

- [ ] **Step 2: Run `npm test -- player-color`, confirm FAIL.**

- [ ] **Step 3: Implement `lib/player/player-color.js`**

```js
// Deterministic, evenly-spread bright color from a userId.
export function playerColor(userId) {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return hslToHex(h % 360, 65, 55);
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const hex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
```

- [ ] **Step 4: Run `npm test -- player-color`, confirm PASS (2 tests).**
- [ ] **Step 5: Commit** `git add lib/player/player-color.js test/player-color.test.js && git commit -m "feat(player): deterministic per-user avatar color"`

---

## Task 4: Session (host/visitor over an injected transport)

This is the networking core. It's transport-agnostic so it can be unit-tested with a fake bus.

**Transport interface** (what `session.js` consumes; implemented for real in Task 5):
```
transport = {
  myId(): string,
  isHost(): boolean,
  send(payload, toUserId?): void,   // broadcast, or targeted if toUserId given
  onMessage(cb: (fromUserId, payload) => void): void,
  onJoin(cb: ({userId, name}) => void): void,    // host-relevant
  onLeave(cb: ({userId}) => void): void,
}
```

**Files:** create `lib/net/session.js`, `test/session.test.js`

- [ ] **Step 1: Write `test/session.test.js`** (fake in-memory transport links a host and a visitor)

```js
import { describe, it, expect } from 'vitest';
import { createWorld, fillFloor, setBlock, getBlock } from '../lib/voxel/store.js';
import { createSession } from '../lib/net/session.js';

// A synchronous in-memory network: messages deliver immediately (deterministic tests).
function makeNetwork() {
  const onMsg = {}, onJoin = {}, onLeave = {};
  function transportFor(id, host) {
    return {
      myId: () => id, isHost: () => host,
      send(payload, to) {
        const copy = () => JSON.parse(JSON.stringify(payload));
        if (to) { if (to !== id && onMsg[to]) onMsg[to](id, copy()); return; }
        for (const uid of Object.keys(onMsg)) if (uid !== id) onMsg[uid](id, copy());
      },
      onMessage(cb) { onMsg[id] = cb; },
      onJoin(cb) { onJoin[id] = cb; },
      onLeave(cb) { onLeave[id] = cb; },
    };
  }
  return {
    transportFor,
    join: (hostId, who) => onJoin[hostId] && onJoin[hostId](who),
    leave: (hostId, who) => onLeave[hostId] && onLeave[hostId](who),
  };
}

function noopHooks(extra = {}) {
  return Object.assign({
    onSnapshot() {}, applyRemoteEdit() {}, onPos() {}, onPlayerLeft() {},
    onPlayers() {}, onPermChange() {}, onEnded() {}, worldName: 'W',
  }, extra);
}

describe('session', () => {
  it('streams the world to a joining visitor', () => {
    const net = makeNetwork();
    const hw = createWorld(); fillFloor(hw, 8); setBlock(hw, 3, 1, 3, 5);
    createSession({ transport: net.transportFor('host', true), getWorld: () => hw, ownerId: 'host', hooks: noopHooks() });
    let vw = null;
    createSession({ transport: net.transportFor('vis', false), getWorld: () => vw, ownerId: 'host',
      hooks: noopHooks({ onSnapshot: (w) => { vw = w; } }) });
    net.join('host', { userId: 'vis', name: 'Vee' });
    expect(vw).not.toBeNull();
    expect(getBlock(vw, 3, 1, 3)).toBe(5);
    expect(getBlock(vw, 0, 0, 0)).toBe(8);
  });

  it('a granted visitor edit syncs to the host and back', () => {
    const net = makeNetwork();
    const hw = createWorld(); fillFloor(hw, 8);
    const host = createSession({ transport: net.transportFor('host', true), getWorld: () => hw, ownerId: 'host', hooks: noopHooks() });
    let vw = null;
    const vis = createSession({ transport: net.transportFor('vis', false), getWorld: () => vw, ownerId: 'host',
      hooks: noopHooks({ onSnapshot: (w) => { vw = w; } }) });
    net.join('host', { userId: 'vis', name: 'Vee' });
    host.setPermission('vis', true);
    vis.requestEdit(5, 2, 5, 7);
    expect(getBlock(hw, 5, 2, 5)).toBe(7);   // host applied
    expect(getBlock(vw, 5, 2, 5)).toBe(7);   // echoed to visitor
  });

  it('an ungranted visitor cannot edit', () => {
    const net = makeNetwork();
    const hw = createWorld(); fillFloor(hw, 8);
    createSession({ transport: net.transportFor('host', true), getWorld: () => hw, ownerId: 'host', hooks: noopHooks() });
    let vw = null;
    const vis = createSession({ transport: net.transportFor('vis', false), getWorld: () => vw, ownerId: 'host',
      hooks: noopHooks({ onSnapshot: (w) => { vw = w; } }) });
    net.join('host', { userId: 'vis', name: 'Vee' });
    vis.requestEdit(5, 2, 5, 7);              // not granted
    expect(getBlock(hw, 5, 2, 5)).toBe(0);
  });

  it('host edits broadcast to visitors', () => {
    const net = makeNetwork();
    const hw = createWorld(); fillFloor(hw, 8);
    const host = createSession({ transport: net.transportFor('host', true), getWorld: () => hw, ownerId: 'host', hooks: noopHooks() });
    let vw = null;
    createSession({ transport: net.transportFor('vis', false), getWorld: () => vw, ownerId: 'host',
      hooks: noopHooks({ onSnapshot: (w) => { vw = w; } }) });
    net.join('host', { userId: 'vis', name: 'Vee' });
    host.requestEdit(1, 2, 1, 9);
    expect(getBlock(vw, 1, 2, 1)).toBe(9);
  });
});
```

- [ ] **Step 2: Run `npm test -- session`, confirm FAIL.**

- [ ] **Step 3: Implement `lib/net/session.js`**

```js
import { applyEdit } from '../voxel/edit.js';
import { serialize, deserialize } from '../voxel/rle.js';
import { T, chunkSnapshot, SnapshotReassembler } from './protocol.js';
import { createPermissions } from './permissions.js';

// hooks: {
//   onSnapshot(world)         visitor: a freshly received world is ready to render
//   applyRemoteEdit(x,y,z,b,dirty)  a block changed (re-mesh those chunks)
//   onPos(userId, {x,y,z,yaw,pitch}) a remote player's position update
//   onPlayerLeft(userId)
//   onPlayers(list)           host: player roster changed (for the Players panel)
//   onPermChange(canEdit)     visitor: my build right changed
//   onEnded()                 the session ended (host left)
//   worldName                 string
// }
export function createSession({ transport, getWorld, ownerId, hooks }) {
  const isHost = transport.isHost();
  const perms = createPermissions(ownerId);
  const reasm = new SnapshotReassembler();
  let myCanEdit = isHost;

  function applyAndDirty(x, y, z, b) {
    const r = applyEdit(getWorld(), x, y, z, b);
    if (r.ok) hooks.applyRemoteEdit(x, y, z, b, r.dirty);
    return r;
  }

  transport.onMessage((from, p) => {
    switch (p.t) {
      case T.WELCOME: break; // meta only; world arrives via SNAPSHOT
      case T.SNAPSHOT: {
        const blob = reasm.add(p);
        if (blob) hooks.onSnapshot(deserialize(blob));
        break;
      }
      case T.EDIT_REQ: {
        if (!isHost || !perms.canEdit(from)) break;       // permission gate (host only)
        const r = applyAndDirty(p.x, p.y, p.z, p.b);
        if (r.ok) transport.send({ t: T.EDIT, x: p.x, y: p.y, z: p.z, b: p.b });
        break;
      }
      case T.EDIT:
        if (!isHost) applyAndDirty(p.x, p.y, p.z, p.b);    // host already applied its own
        break;
      case T.POS: hooks.onPos(from, p); break;
      case T.PERM:
        if (!isHost && p.userId === transport.myId()) { myCanEdit = p.canEdit; hooks.onPermChange(p.canEdit); }
        break;
      case T.BYE: hooks.onPlayerLeft(from); break;
    }
  });

  if (isHost) {
    transport.onJoin(({ userId, name }) => {
      perms.add(userId, name);
      transport.send({ t: T.WELCOME, name: hooks.worldName }, userId);
      for (const piece of chunkSnapshot(serialize(getWorld()))) {
        transport.send({ t: T.SNAPSHOT, seq: piece.seq, total: piece.total, data: piece.data }, userId);
      }
      hooks.onPlayers(perms.list());
    });
    transport.onLeave(({ userId }) => { perms.remove(userId); hooks.onPlayerLeft(userId); hooks.onPlayers(perms.list()); });
  }

  return {
    isHost,
    canEditLocal() { return isHost || myCanEdit; },
    players() { return perms.list(); },
    requestEdit(x, y, z, b) {
      if (isHost) {
        const r = applyAndDirty(x, y, z, b);
        if (r.ok) transport.send({ t: T.EDIT, x, y, z, b });
      } else if (myCanEdit) {
        transport.send({ t: T.EDIT_REQ, x, y, z, b });     // wait for the authoritative echo
      }
    },
    sendPos(cam) { transport.send({ t: T.POS, x: cam.pos[0], y: cam.pos[1], z: cam.pos[2], yaw: cam.yaw, pitch: cam.pitch }); },
    setPermission(userId, canEdit) {
      if (!isHost) return;
      perms.set(userId, canEdit);
      transport.send({ t: T.PERM, userId, canEdit });
      hooks.onPlayers(perms.list());
    },
  };
}
```

- [ ] **Step 4: Run `npm test -- session`, confirm PASS (4 tests).**
- [ ] **Step 5: Commit** `git add lib/net/session.js test/session.test.js && git commit -m "feat(net): host-authoritative session (snapshot, edit-req gate, perm) over injectable transport"`

---

## Task 5: PlaySDK transport adapter

Wraps `PlaySDK.multiplayer` into the transport interface. Browser module (no unit test; exercised in
the 2-window manual test in Task 9).

**Files:** create `lib/net/play-transport.js`

- [ ] **Step 1: Implement `lib/net/play-transport.js`**

```js
// Adapts PlaySDK.multiplayer to the { myId, isHost, send, onMessage, onJoin, onLeave } interface
// that session.js consumes. `room` is the object returned by createRoom/joinRoom.
export function makePlayTransport(sdk, room, myUserId) {
  const mp = sdk.multiplayer;
  return {
    myId: () => myUserId,
    isHost: () => room.isHost,
    send: (payload, to) => mp.send(payload, to),
    onMessage: (cb) => mp.onMessage((from, payload) => cb(from, payload)),
    onJoin: (cb) => mp.on('playerJoined', (p) => cb({ userId: p.userId, name: p.displayName || 'Player' })),
    onLeave: (cb) => mp.on('playerLeft', (p) => cb({ userId: p.userId })),
  };
}

// Helper: resolve this client's userId from the SDK token (sub claim), best-effort.
export function currentUserId(sdk) {
  try { return sdk.getUserId ? sdk.getUserId() : null; } catch { return null; }
}
```

Note: if `sdk.getUserId` is unavailable, `main.js` (Task 8) will fall back to `room.hostId` for the
host and a generated id for visitors — the exact source is wired there. Keep this adapter thin.

- [ ] **Step 2: `node --check lib/net/play-transport.js`** — must pass.
- [ ] **Step 3: Commit** `git add lib/net/play-transport.js && git commit -m "feat(net): PlaySDK.multiplayer transport adapter"`

---

## Task 6: Avatars (blocky humanoid + name)

**Files:** create `lib/render/avatars.js`

Browser/three.js module. One avatar per remote player: a `Group` with a head cube + body box tinted
the player's color, plus a name sprite. Positions are interpolated toward the latest `pos` each frame.

- [ ] **Step 1: Implement `lib/render/avatars.js`**

```js
import { playerColor } from '../player/player-color.js';

const THREE = window.THREE;

export function createAvatars(scene) {
  const avatars = new Map(); // userId -> { group, target:{x,y,z,yaw}, head }

  function nameSprite(text) {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
    const g = cv.getContext('2d');
    g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(0, 0, 256, 64);
    g.fillStyle = '#fff'; g.fillText(text.slice(0, 14), 128, 34);
    const tex = new THREE.CanvasTexture(cv);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    spr.scale.set(2.2, 0.55, 1); spr.position.set(0, 2.5, 0);
    return spr;
  }

  function ensure(userId, name) {
    if (avatars.has(userId)) return avatars.get(userId);
    const color = playerColor(userId);
    const group = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.0, 0.35), mat);
    body.position.y = 0.5;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), mat);
    head.position.y = 1.3;
    group.add(body); group.add(head); group.add(nameSprite(name || 'Player'));
    scene.add(group);
    const rec = { group, head, target: { x: 0, y: 0, z: 0, yaw: 0 } };
    avatars.set(userId, rec);
    return rec;
  }

  // p = {x,y,z,yaw,pitch}. The avatar stands ~1.6 below eye height.
  function setTarget(userId, name, p) {
    const rec = ensure(userId, name);
    rec.target = { x: p.x, y: p.y - 1.6, z: p.z, yaw: p.yaw };
  }

  function remove(userId) {
    const rec = avatars.get(userId);
    if (!rec) return;
    scene.remove(rec.group);
    rec.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.map) o.material.map.dispose(); });
    avatars.delete(userId);
  }

  function update(dt) {
    const k = 1 - Math.exp(-12 * dt);
    for (const rec of avatars.values()) {
      const g = rec.group, t = rec.target;
      g.position.x += (t.x - g.position.x) * k;
      g.position.y += (t.y - g.position.y) * k;
      g.position.z += (t.z - g.position.z) * k;
      g.rotation.y += (t.yaw - g.rotation.y) * k;
    }
  }

  function clear() { for (const id of [...avatars.keys()]) remove(id); }

  return { setTarget, remove, update, clear };
}
```

- [ ] **Step 2: `node --check lib/render/avatars.js`** — must pass.
- [ ] **Step 3: Commit** `git add lib/render/avatars.js && git commit -m "feat(render): blocky-humanoid avatars with name sprites + interpolation"`

---

## Task 7: Menus (main menu + in-world share/players panel)

**Files:** create `lib/ui/menus.js`

Browser module. The main menu is a full-screen overlay shown on boot; the in-world panel is opened by
the existing `☰` button.

- [ ] **Step 1: Implement `lib/ui/menus.js`**

```js
// Minimal DOM menus. createMainMenu resolves once the user picks how to start.
// onHost() -> start hosting your world; onJoin(code) -> join by code.
export function showMainMenu({ onHost, onJoin, displayName }) {
  const el = document.createElement('div');
  el.id = 'mainmenu';
  el.style.cssText = 'position:absolute;inset:0;z-index:10;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:rgba(15,17,21,.92);color:#fff;font-family:system-ui,sans-serif;pointer-events:auto';
  el.innerHTML = `
    <h1 style="margin:0 0 6px;font-size:30px">BlockWorld</h1>
    <div style="opacity:.7;font-size:13px">${displayName ? 'Signed in as ' + displayName : 'Playing as guest'}</div>
    <button id="mm-host" style="width:240px;height:52px;font-size:17px;font-weight:600;border:0;border-radius:10px;background:#5EA918;color:#fff;cursor:pointer">Play My World</button>
    <div style="display:flex;gap:8px">
      <input id="mm-code" placeholder="CODE" maxlength="6" style="width:120px;height:48px;text-align:center;font-size:18px;text-transform:uppercase;border-radius:10px;border:2px solid #444;background:#1a1d23;color:#fff">
      <button id="mm-join" style="width:112px;height:52px;font-size:16px;font-weight:600;border:0;border-radius:10px;background:#3C44AA;color:#fff;cursor:pointer">Join</button>
    </div>
    <div id="mm-status" style="height:18px;font-size:13px;color:#f8c627"></div>`;
  document.body.appendChild(el);
  const status = el.querySelector('#mm-status');
  el.querySelector('#mm-host').onclick = () => { status.textContent = 'Starting…'; onHost(); };
  el.querySelector('#mm-join').onclick = () => {
    const code = el.querySelector('#mm-code').value.trim().toUpperCase();
    if (!code) { status.textContent = 'Enter a code'; return; }
    status.textContent = 'Joining…'; onJoin(code);
  };
  return { setStatus: (t) => { status.textContent = t; }, close: () => el.remove() };
}

// In-world panel toggled by the ☰ button. getState() returns
// { isHost, code, players:[{userId,name,canEdit}] }. onToggle(userId,canEdit), onLeave().
export function createInWorldMenu({ getState, onToggle, onLeave }) {
  let el = null;
  function render() {
    const s = getState();
    el.innerHTML = `
      <div style="font-weight:700;font-size:16px;margin-bottom:8px">Menu</div>
      ${s.isHost ? `<div style="margin-bottom:8px">Share code: <b style="font-size:20px;letter-spacing:2px">${s.code || '…'}</b></div>` : ''}
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

- [ ] **Step 2: `node --check lib/ui/menus.js`** — must pass.
- [ ] **Step 3: Commit** `git add lib/ui/menus.js && git commit -m "feat(ui): main menu (host/join) + in-world share/players panel"`

---

## Task 8: Wire multiplayer into main.js

**Files:** modify `main.js`

Replace the immediate solo boot with: main menu → host or visitor session → world/render/avatars,
edit routing through the session, a position-broadcast loop, and host-only autosave.

- [ ] **Step 1: Rewrite `main.js`** to the following (it supersedes the Plan 1 version):

```js
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
      menu.setStatus(host ? 'Could not host (are you signed in?)' : 'Join failed — check the code');
      return;
    }
    const myId = (sdk.getUserId && sdk.getUserId()) || (host ? ownerId : 'me-' + Math.floor(performance.now()));
    transport = makePlayTransport(sdk, room, myId);
    menu.close();
    runGame({ sdk, room, transport, ownerId, host });
  }
}

function runGame({ sdk, room, transport, ownerId, host }) {
  let world = null;

  const view = createWorldView(canvas, /*placeholder*/ (world = createWorld()));
  const avatars = createAvatars(view.scene);
  const cam = createFlyCamera([WX / 2, 4, WZ / 2], 0, -0.35);
  const autosave = host && sdk && sdk.save ? makeAutosaver(sdk, () => world, 3000) : () => {};

  const session = createSession({
    transport, ownerId, getWorld: () => world,
    hooks: {
      worldName: 'World',
      onSnapshot: (w) => { world = w; rebindWorld(); },
      applyRemoteEdit: (x, y, z, b, dirty) => { dirty.forEach((id) => view.rebuildChunk(id)); if (host) autosave(); },
      onPos: (userId, p) => avatars.setTarget(userId, userId, p),
      onPlayerLeft: (userId) => avatars.remove(userId),
      onPlayers: () => inWorld.refresh(),
      onPermChange: () => {},
      onEnded: () => { /* handled via disconnected below */ },
    },
  });

  // world-view was created against a placeholder; rebind its chunk source when the real world lands.
  function rebindWorld() { view.setWorld(world); view.rebuildAll(); }

  if (host) {
    world = createWorld(); fillFloor(world, 8);
    if (sdk && sdk.load) loadCurrent(sdk).then((w) => { if (w) { world = w; } rebindWorld(); }).catch(rebindWorld);
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
    onLeave: () => { try { room.leave(); } catch {} location.reload(); },
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
  if (sdk.onPause) sdk.onPause(() => { running = false; });
  if (sdk.onResume) sdk.onResume(() => { if (!running) { running = true; last = performance.now(); loop(last); } });
  window.addEventListener('beforeunload', () => { if (host && sdk.save) saveCurrent(sdk, world); });

  let running = true, last = performance.now(), posTimer = 0;
  function loop(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const intent = mobile ? mobile.pollIntent() : desktop.pollIntent();
    updateFlyCamera(cam, intent, dt);
    avatars.update(dt);
    posTimer += dt;
    if (posTimer >= 0.08) { posTimer = 0; session.sendPos(cam); } // ~12 Hz
    const target = raycast(world, cam.pos, lookDir(cam), REACH);
    view.setHighlight(target ? target.cell : null);
    view.render(cam);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

if (window.PlaySDK && window.PlaySDK.onReady) window.PlaySDK.onReady(boot); else boot();
```

- [ ] **Step 2: Add a `setWorld` setter to `lib/render/world-view.js`** so the view can rebind to a
world received from a snapshot. Inside `createWorldView`, change `world` from a parameter the closures
capture directly to a mutable local, and expose a setter:

In `lib/render/world-view.js`, add after the `meshes` map:
```js
  let currentWorld = world;
  function setWorld(w) { currentWorld = w; }
```
Then in `rebuildChunk`, change `meshChunk(world, ...)` to `meshChunk(currentWorld, ...)`, and add
`setWorld` to the returned object: `return { renderer, scene, camera, rebuildChunk, rebuildAll, render, resize, setHighlight, setWorld };`

- [ ] **Step 3: `node --check main.js && node --check lib/render/world-view.js`** — must pass.
- [ ] **Step 4: `npm test`** — confirm the existing unit tests (Plan 1's 25 + this plan's protocol/permissions/player-color/session) all still pass.
- [ ] **Step 5: Commit** `git add main.js lib/render/world-view.js && git commit -m "feat: wire host/visitor multiplayer (menu, session, avatars, pos loop, perms)"`

---

## Task 9: Two-window manual verification

No code (verification task). The relay needs two signed-in clients.

- [ ] **Step 1:** `npm run dev`, open `http://localhost:8093` in two browser windows (or two profiles),
both signed in via the platform (multiplayer requires auth). In window A click **Play My World**; open
the `☰` menu and note the **share code**.
- [ ] **Step 2:** In window B enter the code and **Join**. Confirm B sees A's world (build something in A
first), and that A appears as a blocky avatar with a name in B (and vice-versa) moving in real time.
- [ ] **Step 3:** In B, try to build — nothing happens (view-only). In A's `☰` Players panel, toggle B to
**Can build**. Now B can place/erase and the changes appear in A.
- [ ] **Step 4:** Close A. Confirm B gets the "Session ended" notice.
- [ ] **Step 5:** Document the result (works / issues) in the PR or commit message. If the relay is
unreachable in your environment, note it — the unit-tested session core still validates the protocol.

---

## Task 10: Carry-over fixes + finalize

**Files:** modify `lib/voxel/edit.js`, `lib/input/mobile.js` (verify), `index.html`, `package.json`

- [ ] **Step 1: Clamp `cy` in `dirtyChunksFor`** (`lib/voxel/edit.js`) — change the guard in `add` to also
reject `cy >= NCY`. Import `NCY` from constants:
```js
import { CHUNK, NCX, NCY, NCZ, inBounds, chunkId } from '../constants.js';
// ...
  const add = (cx, cy, cz) => {
    if (cx < 0 || cy < 0 || cz < 0 || cx >= NCX || cy >= NCY || cz >= NCZ) return;
    ids.add(chunkId(cx, cy, cz));
  };
```
Run `npm test -- edit` — the existing 4 tests still pass (the boundary test only touches x).

- [ ] **Step 2: Mobile look-drag** — confirm on a real touch device (or note it as untested) that dragging
the right half of the screen rotates the camera. The listeners are on the canvas (Plan 1 v0.2.1 fix).
No code change unless the device test fails; if it does, report it as a follow-up bug, don't guess.

- [ ] **Step 3: Bump version** to `v0.3.0` in `index.html` (meta tag + `#ver` span) and `package.json`.
Confirm `grep -c v0.3.0 index.html` prints 2 and no `v0.2.` remains.

- [ ] **Step 4: Full check** — `npm test` (all suites pass) and `npm run smoke` (the game still boots to the
main menu and the smoke screenshot succeeds; note: the smoke test loads with no PlaySDK so it shows the
main menu — update `scripts/smoke.mjs` only if needed to click "Play My World" before sampling pixels;
if so, keep the change minimal and documented).

- [ ] **Step 5: Commit** `git add -A && git commit -m "chore: Plan 2 complete — multiplayer playable; cy clamp; v0.3.0"`

---

## Self-Review (completed during authoring)

- **Spec coverage:** §4 roles/host-authoritative → Tasks 4,8; §5 protocol (welcome/snapshot/edit-req/
  edit/pos/perm/bye) → Tasks 1,4; snapshot chunking → Task 1; per-person grants + Players panel → Tasks
  2,4,7,8; avatars+names → Task 6; host/join menus → Tasks 7,8; host-only persistence → Task 8. Multi-world
  "My Worlds" intentionally deferred (stated up top).
- **Placeholders:** none — every code step is complete. The only non-code steps are the inherently-human
  2-window relay test (Task 9) and the on-device mobile check (Task 10.2), both with explicit procedures.
- **Type/name consistency:** transport interface `{myId,isHost,send,onMessage,onJoin,onLeave}` is produced
  by `makePlayTransport` and the test's fake, and consumed by `createSession` identically. `session`
  surface (`requestEdit/sendPos/setPermission/canEditLocal/players/isHost`) matches `main.js` usage.
  `hooks` keys match between `session.js`, the test, and `main.js`. `view.setWorld/setHighlight/
  rebuildChunk/rebuildAll/render` all defined in Task 8 Step 2 + Plan 1.
- **Smoke caveat flagged:** Task 10.4 notes the smoke test now lands on the main menu (no PlaySDK), so it
  may need a click before sampling — called out rather than left to surprise the implementer.
