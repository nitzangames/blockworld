# BlockWorld — Multiplayer Creative Block Builder (Build 1 Design)

**Date:** 2026-06-14
**Slug:** `blockworld`
**Platform:** play.nitzan.games (PlaySDK, three.js r128, ES modules, single-page game zip)
**Status:** Design approved; spec under user review before plan.

## 1. Concept

A Minecraft-creative-style game where players build structures out of colored blocks in a
fixed-size world, alone or **together in real time**. You sign in, create a new world or load
one of your saved worlds, and it goes **live**: you can share a join code and other people fly
into your world to look around or build with you. By default visitors can only look; the world
owner grants build rights to individual visitors from a menu. The game is always multiplayer
(a live session), but works solo when no one else has joined.

World size is fixed at **128 × 128 × 64** (X width × Z length × Y height).

## 2. Hard platform constraints (these shaped the design)

The PlaySDK multiplayer API (`lib/play-sdk.js`) is a **live WebSocket message relay**, not a
state store:

- `PlaySDK.multiplayer.createRoom({maxPlayers, visibility})` → room with a short **code**.
- `room.send(payload, to?)` broadcasts a JSON payload to all peers, or to one `userId` if `to` is set.
- `PlaySDK.multiplayer.on("game", (fromUserId, payload) => …)` receives.
- Events: `playerJoined`, `playerLeft`, `hostChanged`, `kicked`, `disconnected`, plus a host concept
  (`room.isHost`, `room.hostId`, `room.kick`, `room.start`).
- **There is no server-side world storage and rooms are ephemeral** — when the host disconnects the
  room is gone.

Persistence is per-user cloud key-value strings only:

- `PlaySDK.save(key, value)` / `PlaySDK.load(key)` → stored in Postgres `game_saves`
  (per `user_id` + `slug` + `key`, value is TEXT). A user cannot read another user's saves.

**Consequence:** the model is **host-authoritative live sessions**. A world is visitable only while
its owner is online hosting it. The world persists in the owner's own cloud save so the owner can
reload it later, but strangers cannot visit while the owner is offline (that would require an
always-on custom backend the platform does not provide). The user accepted this.

## 3. Confirmed decisions

| Topic | Decision |
|---|---|
| Hosting model | Host-authoritative live sessions (owner online = world live) |
| Movement | Creative fly only (6-direction free flight, no gravity/collision) |
| New-world start state | Single-layer flat grass floor filling 128×128 at y=0, open sky |
| Block look | Solid flat-shaded blocks (matte color + directional light + baked AO) |
| Palette | 16 fixed colors (Minecraft-wool-like), block type = 1 byte |
| Co-presence | Live avatars + floating names for everyone connected |
| Edit rights | **Per-person** grant — owner toggles build rights per individual visitor; host enforces |
| Platforms | Desktop **and** mobile touch, both in Build 1 |

16-color palette (index 1–16; 0 = air):
`#E9ECEC #8E8E86 #3B4044 #1D1C21 #B02E26 #F07613 #F8C627 #5EA918 #5E7C16 #157788 #3AAFD9 #3C44AA #8932B8 #BD44B3 #ED8DAC #835432`

## 4. Architecture overview

```
Owner's browser (HOST)                          Visitor's browser
┌──────────────────────────────┐               ┌──────────────────────────────┐
│ Authoritative voxel store      │  snapshot ──▶ │ Local voxel store (copy)       │
│ (Uint8Array 128*128*64 ≈ 1MB) │   edits  ◀──▶  │ Voxel renderer (chunk meshes)  │
│ Voxel renderer (chunk meshes)  │  positions◀─▶ │ Other players' avatars         │
│ Permission table (userId→bool) │               │ edit-request ──▶ host          │
│ PlaySDK.save (ONLY host writes) │               │                                │
└──────────────────────────────┘               └──────────────────────────────┘
            ▲  PlaySDK.multiplayer room (relay) ▼
   pos · edit-req · edit · snapshot · perm · meta · welcome
```

**Roles:** the player who creates or loads a world becomes the **host** (calls `createRoom`,
holds the authoritative store, is the only writer to cloud). Anyone who `joinRoom(code)` is a
**visitor** — a spectator by default, a builder once the host grants rights. Host leaves →
session ends (world already autosaved). No host migration in Build 1 (if host drops, visitors
get a "session ended" notice).

### 3-option choice for sync (chosen: A)

- **A. Host-authoritative with edit-request validation (CHOSEN).** Host owns the store. Visitors
  send `edit-req`; host checks permission + bounds and broadcasts the authoritative `edit` (the
  host's own edits broadcast the same way). Only the host saves. Chosen because per-person edit
  grants are only enforceable if a single trusted authority gates writes, and it makes persistence
  trivial (one writer, always consistent). The extra host hop is imperceptible for building.
- **B. Peer broadcast / optimistic local apply.** Lower latency but permission becomes client-trust
  and conflicts/persistence get messy. Rejected.
- **C. CRDT / op-log.** Overkill for a single-authority creative builder. Rejected.

## 5. Network protocol (payloads over `room.send`)

All payloads are small JSON objects with a `t` (type) field.

| `t` | Direction | Rate | Payload | Purpose |
|---|---|---|---|---|
| `welcome` | host → joining visitor (`to`) | once | `{name, version}` | world meta on join |
| `snapshot` | host → joining visitor (`to`) | once, chunked | `{seq, total, data}` | RLE world in N base64 pieces |
| `edit-req` | visitor → host | per action | `{x,y,z,b}` | request a block change (b=0 break) |
| `edit` | host → all | per action | `{x,y,z,b}` | authoritative block change |
| `pos` | every player → all | ~12 Hz | `{x,y,z,yaw,pitch}` | drive avatars (interpolated) |
| `perm` | host → all | on change | `{userId, canEdit}` | build-rights change |
| `bye` | leaving player → all | once | `{}` | remove avatar promptly |

Notes:
- **Snapshot chunking:** the RLE world blob is split into base64 pieces sized safely under the
  relay's per-message limit; visitor reassembles by `seq`/`total`, then meshes. Until the snapshot
  is complete the visitor shows a "Loading world…" state.
- **Host self-edits** also flow through the `edit` path so the renderer has one apply path.
- **Permission enforcement:** host drops `edit-req` from a `userId` whose `canEdit` is false (or who
  isn't the owner). Visitors also hide their own build UI when not granted, but the host is the gate.
- `pos` for absent/late players is interpolated; avatars dead-reckon between updates and are removed
  on `bye`/`playerLeft`.

## 6. Voxel engine

- **Store:** flat `Uint8Array(128*128*64)`, index `x + z*128 + y*128*128` (or a documented stride;
  exact order fixed in the plan). 0 = air, 1–16 = palette.
- **Chunking:** `16×16×16` chunks → `8×8×4 = 256` chunks. Each chunk owns one `THREE.Mesh`.
- **Meshing:** culled face meshing — emit a quad only where a solid block faces air (or the world
  edge). **Per-vertex color** (block's palette color) on a **single shared `MeshLambertMaterial`
  with `vertexColors`** — the whole world is a few draw calls, no atlas, no per-color materials.
- **Baked AO:** per-vertex darkening from the 3 neighbors at each face corner (the classic voxel AO),
  multiplied into vertex color, for the solid readable look chosen.
- **Dirty re-mesh:** an edit marks its chunk dirty (and the neighbor chunk if the block is on a chunk
  boundary face); only dirty chunks rebuild. Single-chunk rebuild is cheap on the main thread; the
  mesher is written **pure (inputs→geometry arrays) so it can move to a Web Worker** if mobile
  stutters.
- **Targeting:** voxel DDA raycast from the crosshair (screen center) finds hit cell + face normal.
  Break clears the hit cell; place sets the air cell on the hit face (rejected if it would land
  outside bounds or inside a player).
- **Mobile WebGL budget** (per platform notes): clamp `setPixelRatio` (≤1.5), `antialias:false` on
  mobile, a single `WebGLRenderer` reused for the whole session, fog for depth + draw-distance feel.

## 7. Persistence (host only)

- **Serialization:** iterate cells in fixed order, run-length encode `(blockType, runLength)`,
  varint-encode runs, base64 the bytes. A flat floor + typical builds → tens of KB.
- **Keys:**
  - `world:<id>` → the RLE blob for that world.
  - `worlds-index` → JSON array `[{id, name, updatedAt}]` for the "My Worlds" menu.
- **Safeguard (designed-for, not built in Build 1 UI):** if a blob exceeds a safe size threshold,
  split across `world:<id>:r0…rN` region keys and record the part count in the index. Build 1 ships
  single-key + RLE; most creative worlds are well under the limit.
- **When:** debounced autosave a few seconds after the last edit, and on session end / `onPause`.
  **Visitors never write.** World `id` is generated at create time (host userId + counter, no
  `Math.random`/`Date.now` reliance for determinism in tooling; a monotonic counter persisted in the
  index is fine at runtime).

## 8. Controls & UX

**Desktop:** `WASD` horizontal, `Space`/`Shift` fly up/down, pointer-lock mouse look, **left-click
break / right-click place**, number keys + scroll to change palette color, click palette swatch,
`Esc` opens menu / releases pointer-lock. Crosshair centered.

**Mobile (portrait 1080×1920):** left-thumb move joystick (horizontal), right-thumb drag to look,
**Up/Down fly buttons** lower-right, **Break/Place buttons** (crosshair-targeted), tap a palette
swatch to pick color. HUD follows the platform's portrait-HUD rules (no desync between canvas px and
safe-area CSS).

`desktop_fill: true` so desktop players get a full window rather than a letterboxed portrait strip.

**Portrait HUD layout:**
```
☰ World name                    v0.x      ← top bar: menu, name, version stamp
                  ✛                       ← crosshair
                              ▲ up
   ◉ move                     ▼ down
 joystick           [break] [place]
 ▌🟥🟧🟨🟩🟦🟪⬜… ← scrollable palette strip
```

**Menus:**
- **Main menu:** sign-in state · **My Worlds** (load list) · **New World** · **Join by Code**.
- **In-world menu (`☰`):** world name · **Share code** (room code to invite) · **Players panel**
  (each connected visitor with a build-rights toggle = the per-person grant) · Save · Leave.
- New visitors appear in the players panel; owner flips their toggle to allow building. Owner can
  also kick (`room.kick`).

## 9. Build-1 scope

**In:** sign-in + main menu; create / list / load / rename worlds; flat-floor world gen; creative
fly; crosshair place/break with 16-color palette; chunked culled meshing + AO; host-authoritative
multiplayer (room, share code, snapshot-on-join, live edit sync); live avatars + names; per-person
edit grants with host enforcement; RLE cloud persistence (host autosave + on exit); desktop + mobile
controls; `desktop_fill`; mobile WebGL budget; on-screen version stamp; `onPause`/`onResume`.

**Out (future builds):** block types beyond solid colors (glass/transparent, emissive light, metal);
undo/redo; selection / copy-paste regions; world thumbnails/screenshots in the list; text chat /
voice; the save-blob region-split *UI* (splitter is designed-for); procedural terrain options;
host migration; always-on persistent hosting.

## 10. Top risks & mitigations

1. **Snapshot transfer over the relay on join** — unknown per-message size cap. Mitigation: chunk the
   RLE blob into small base64 pieces with `seq/total` reassembly; show a loading state; verify with a
   densely-built world.
2. **Mobile mesh-rebuild cost on edits** — single-chunk rebuild on the main thread may hitch on
   low-end phones. Mitigation: keep the mesher pure and worker-ready; move to a Web Worker if needed.
3. **Save-blob size for dense worlds** — TEXT column is generous but the HTTP/edge body may cap.
   Mitigation: RLE keeps typical worlds tiny; region-split keys are designed-for as a fallback.
4. **Permission spoofing** — a tampered visitor client could try to edit. Mitigation: host is the sole
   write gate; it ignores `edit-req` from non-granted users regardless of client UI state.

## 11. Module boundaries (for the plan)

- `voxel/store.js` — the Uint8Array world, get/set, bounds, RLE serialize/deserialize. Pure.
- `voxel/mesher.js` — chunk → geometry arrays (positions, colors w/ AO, indices). Pure, worker-ready.
- `render/world-view.js` — three.js scene, chunk meshes, dirty-chunk re-mesh, fog/lights.
- `render/avatars.js` — other players' avatar meshes + name sprites, interpolation.
- `input/desktop.js`, `input/mobile.js` — controls → intents (move, look, place, break, pick).
- `player/fly-camera.js` — creative fly camera from movement intents.
- `net/session.js` — room lifecycle, protocol encode/decode, host vs visitor logic, permission gate.
- `persist/worlds.js` — PlaySDK save/load, worlds-index, autosave debounce.
- `ui/menus.js`, `ui/hud.js` — main menu, in-world menu, players panel, palette, version stamp.
- `main.js` — wiring + game loop + PlaySDK lifecycle (onReady/onPause/onResume/screenshotMode).

Each unit has one purpose, a small interface, and (for the pure ones) is unit-testable headless.
