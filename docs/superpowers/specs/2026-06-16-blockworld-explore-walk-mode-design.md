# BlockWorld — Explore (Walk) Mode + Edit/Explore Toggle (Design)

**Date:** 2026-06-16
**Slug:** `blockworld`
**Status:** Design approved by user; spec under review before plan.

## 1. Goal

Add a second movement mode so players can **walk** through their creations, not just fly.
A toggle switches between:

- **Edit** (default, current behavior): free 6-direction flight, no collision, can place/remove blocks.
- **Explore**: grounded walking with gravity, wall collision, a jump, and automatic climbing of
  1-block-high steps. Building is **disabled** in this mode (move-only).

Decisions confirmed with the user:

- Explore is **move-only** — no building while walking; switch to Edit to build.
- Physics feel is **standard/grounded** — walk speed below fly speed, a ~1.25-block jump,
  auto-climb of 1-high steps; taller steps require jumping.

## 2. Modes & toggle

- A `mode` value: `'edit' | 'explore'`. **Default `'edit'` on every load** (spawning into a fall
  would be confusing).
- A compact **Fly/Walk toggle button** (`#modeBtn`) in the top-right HUD bar, alongside the
  ▦ outline toggle and the version label. Its label reflects the current mode (`Fly` in Edit,
  `Walk` in Explore) and tapping it switches.
- On switch, **zero the camera velocity** (`cam.vel = [0,0,0]`) so fly momentum doesn't leak into
  walking and vice versa. Entering Explore while airborne simply means gravity pulls the player
  down until they land — no special handling.
- In Explore: `act()` (build/erase) is a no-op, and the crosshair block-highlight is hidden (there
  is nothing to target).

Not persisted across reloads (always starts in Edit). Mobile fly buttons keep their glyphs; in
Explore the ▲ button acts as Jump and ▼ is a no-op (no per-mode relabel in this build — noted as a
possible future polish).

## 3. Walk physics — `lib/player/walk-camera.js` (new)

Single export: `updateWalkCamera(cam, intent, dt, world)`. `cam` is the same shape the fly camera
uses: `{ pos:[x,y,z], yaw, pitch, vel:[vx,vy,vz] }`, where `pos` is the **eye** position. `world`
is the voxel `Uint8Array` (read via `getBlock`). The function mutates `cam` in place and returns it.

### Player body

- `RADIUS = 0.3` (axis-aligned footprint 0.6 × 0.6)
- `HEIGHT = 1.8`
- `EYE = 1.6` (eye above feet)

From the eye `pos`, the AABB is:
`[pos.x±RADIUS]`, vertical `[pos.y - EYE, pos.y - EYE + HEIGHT]`, `[pos.z±RADIUS]`.

### Constants (tunable)

- `WALK_SPEED = 5.5` blocks/s
- `GRAVITY = 30` blocks/s²
- `JUMP_VEL = 8.7` blocks/s (peak ≈ `JUMP_VEL² / (2·GRAVITY)` ≈ 1.26 blocks)
- `STEP = 1.0` (max auto-climb height)
- Horizontal control is responsive: target horizontal velocity from input is approached with
  `k = 1 - exp(-16·dt)` (snappier than fly), applied to `cam.vel[0]/[2]`.

### Per-frame update

1. **Horizontal intent → target velocity.** Using yaw only (not pitch), forward = `(sin yaw, cos yaw)`,
   right = `(-cos yaw, sin yaw)`. `targetVx = (fwd.x·forward + right.x·strafe)·WALK_SPEED`, same for z.
   Approach `cam.vel[0]/[2]` toward target with `k`.
2. **Gravity:** `cam.vel[1] -= GRAVITY·dt`.
3. **Jump:** read the **prior frame's** grounded state from `cam.grounded` (defaults to false). If
   `intent.vertical > 0` **and** `cam.grounded`, set `cam.vel[1] = JUMP_VEL`.
4. **Move + collide, axis by axis** (prevents corner tunneling). Track a local `grounded = false`
   for this frame. For each axis apply `cam.pos[axis] += cam.vel[axis]·dt`, then if the AABB now
   overlaps any solid voxel, resolve:
   - **Y (resolved first):** revert the move and zero `cam.vel[1]`; if the motion was downward, set
     `grounded = true`.
   - **X / Z (horizontal):** if blocked and `grounded` (this frame), attempt **auto-step**: lift
     `pos.y` by `STEP`, re-apply the same horizontal move; if the lifted position is collision-free,
     keep it (the player has stepped up onto a 1-high block; gravity settles them on its top over the
     next frames); otherwise revert both the lift and the horizontal move and zero that axis's velocity.
5. Store `cam.grounded = grounded` for next frame's jump check; return `cam`.

### Collision helper

`collides(world, pos)` builds the AABB from the eye `pos` and scans the integer voxels it overlaps
(`floor(min)` … `floor(max - 1e-4)` on each axis); returns true if any is non-air. Pure, allocation-free
(scalars only) to keep the per-frame loop GC-clean, consistent with the v0.5.7 work.

### Notes / edge cases

- Per-axis **revert** (not snap-to-surface) leaves a ≤ one-frame-of-motion gap (≤ ~0.1 block at walk
  speed); imperceptible given the 1.6-block eye height. Snapping is a possible future refinement.
- `grounded` may toggle frame-to-frame by a hair due to revert; jump still fires reliably on grounded
  frames. Acceptable.
- World bounds: `getBlock` returns 0 (air) out of bounds, so the world edges are open (you can walk/
  fall off the floor's edge). Matches the existing open-world feel; no invisible walls added.

## 4. Integration — `main.js`, `index.html`

- **State:** `let mode = 'edit';` in `runGame`.
- **Loop:** replace `updateFlyCamera(cam, intent, dt)` with
  `mode === 'explore' ? updateWalkCamera(cam, intent, dt, world) : updateFlyCamera(cam, intent, dt)`.
- **`act()`:** add `if (mode !== 'edit') return;` at the top (move-only Explore).
- **Highlight:** `view.setHighlight(mode === 'edit' && target ? target.cell : null)`.
- **`index.html`:** add `#modeBtn` to the topbar right-side group (before `#outlineBtn`), styled like
  the other topbar buttons.
- **Wiring (`runGame`):** clicking `#modeBtn` flips `mode`, zeroes `cam.vel`, sets `cam.grounded = false`,
  and updates the button label (`Fly`/`Walk`). Import `updateWalkCamera`.
- The fly camera, build/erase, mesher, renderer, networking, and persistence are **unchanged**.
- **Multiplayer:** avatars already render 1.6 below the sent eye position, so walking (lower eye)
  needs no avatar change.

## 5. Testing — `test/walk-camera.test.js` (new)

Pure-logic unit tests against `updateWalkCamera` with a hand-built world:

1. **Falls under gravity:** in open air, repeated updates decrease `pos.y`.
2. **Lands on the floor:** over a solid floor at y=0, after enough frames the eye settles at ≈
   `1 + EYE` (feet rest on the floor top at y=1) and stops falling; `cam.grounded` is true.
3. **Jump only when grounded:** `intent.vertical > 0` while grounded gives upward velocity / rising
   `pos.y`; the same intent mid-air does not re-launch.
4. **Auto-climbs a 1-high step:** walking into a single block while grounded raises the player onto it.
5. **Wall blocks movement:** walking into a 2-high wall does not advance horizontal position past it.

(`main.js` and `index.html` are integration glue, verified via the dev-server smoke test and on-device.)

## 6. Out of scope (YAGNI)

Building while walking; per-mode mobile button relabel; head-bob/footstep feedback; swimming/ladders;
crouch; collision snap-to-surface; persisting the selected mode.
