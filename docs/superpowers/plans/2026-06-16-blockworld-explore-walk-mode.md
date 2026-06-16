# Explore (Walk) Mode + Edit/Explore Toggle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a grounded "Explore" walking mode (gravity, wall collision, ~1.25-block jump, auto-climb of 1-high steps) toggleable with the existing fly-based "Edit" mode; Explore is move-only.

**Architecture:** A new pure-logic module `lib/player/walk-camera.js` exports `updateWalkCamera(cam, intent, dt, world)` that mutates the same `{pos,yaw,pitch,vel}` camera the fly camera uses (`pos` = eye), doing per-axis AABB-vs-voxel collision with snap-on-landing and auto-step. `main.js` holds a `mode` flag, branches the loop to fly-or-walk, gates building to Edit mode, and wires a topbar Fly/Walk toggle button added in `index.html`.

**Tech Stack:** Vanilla ES modules, Vitest (the walk physics is unit-tested), three.js (unchanged).

**Spec:** `docs/superpowers/specs/2026-06-16-blockworld-explore-walk-mode-design.md`

---

## File Structure

- `lib/player/walk-camera.js` — **new.** `updateWalkCamera(cam, intent, dt, world)` + a private `collides()` AABB test. Pure logic, allocation-free. (Unit-tested.)
- `test/walk-camera.test.js` — **new.** Physics tests (fall, land, jump-when-grounded, auto-step, wall).
- `main.js` — **modify.** `mode` state, loop branch, `act()` gate, highlight gate, mode-toggle wiring, import.
- `index.html` — **modify.** Add `#modeBtn` to the topbar right-side group.

The fly camera, mesher, renderer, networking, and persistence are untouched.

---

## Task 1: walk-camera module — falling and landing

**Files:**
- Create: `lib/player/walk-camera.js`
- Test: `test/walk-camera.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/walk-camera.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { createWorld, fillFloor, setBlock } from '../lib/voxel/store.js';
import { updateWalkCamera } from '../lib/player/walk-camera.js';

const STILL = { forward: 0, strafe: 0, vertical: 0, dYaw: 0, dPitch: 0 };
function cameraAt(x, y, z, yaw = 0) { return { pos: [x, y, z], yaw, pitch: 0, vel: [0, 0, 0], grounded: false }; }

describe('walk-camera', () => {
  it('falls under gravity in open air', () => {
    const w = createWorld(); // no floor
    const cam = cameraAt(10, 20, 10);
    updateWalkCamera(cam, STILL, 0.05, w);
    expect(cam.pos[1]).toBeLessThan(20);
    expect(cam.grounded).toBe(false);
  });

  it('lands on the floor and stays grounded (eye = floor top + eye height)', () => {
    const w = createWorld(); fillFloor(w, 8); // solid floor at y=0, top surface at y=1
    const cam = cameraAt(10, 5, 10);
    for (let i = 0; i < 200; i++) updateWalkCamera(cam, STILL, 0.016, w);
    expect(cam.pos[1]).toBeCloseTo(2.6, 5); // feet snap to y=1, eye = 1 + 1.6
    expect(cam.grounded).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/walk-camera.test.js`
Expected: FAIL — cannot find module `../lib/player/walk-camera.js`.

- [ ] **Step 3: Create `lib/player/walk-camera.js`**

```js
import { getBlock } from '../voxel/store.js';

// Player body (the camera `pos` is the eye).
const RADIUS = 0.3;   // half-width of the 0.6 x 0.6 footprint
const HEIGHT = 1.8;
const EYE = 1.6;      // eye height above the feet
// Tunables.
const WALK_SPEED = 5.5; // blocks/s
const GRAVITY = 30;     // blocks/s^2
const JUMP_VEL = 8.7;   // blocks/s  -> peak ~1.26 blocks
const STEP = 1.0;       // max auto-climb height
const EPS = 1e-4;

// True if the AABB derived from eye position (px,py,pz) overlaps any solid voxel.
// Scalars only — no allocation (runs several times per frame).
function collides(world, px, py, pz) {
  const x0 = Math.floor(px - RADIUS), x1 = Math.floor(px + RADIUS - EPS);
  const y0 = Math.floor(py - EYE), y1 = Math.floor(py - EYE + HEIGHT - EPS);
  const z0 = Math.floor(pz - RADIUS), z1 = Math.floor(pz + RADIUS - EPS);
  for (let y = y0; y <= y1; y++)
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++)
        if (getBlock(world, x, y, z)) return true;
  return false;
}

// Mutates cam in place; cam = { pos:[x,y,z] (eye), yaw, pitch, vel:[vx,vy,vz], grounded }.
export function updateWalkCamera(cam, intent, dt, world) {
  const p = cam.pos, v = cam.vel;

  // 1. Horizontal target velocity from yaw-relative input (look up/down freely, walk flat).
  const sinY = Math.sin(cam.yaw), cosY = Math.cos(cam.yaw);
  const tvx = (sinY * intent.forward - cosY * intent.strafe) * WALK_SPEED;
  const tvz = (cosY * intent.forward + sinY * intent.strafe) * WALK_SPEED;
  const k = 1 - Math.exp(-16 * dt);
  v[0] += (tvx - v[0]) * k;
  v[2] += (tvz - v[2]) * k;

  // 2. Gravity.
  v[1] -= GRAVITY * dt;

  // 3. Jump uses the prior frame's grounded state.
  if (intent.vertical > 0 && cam.grounded) v[1] = JUMP_VEL;

  // 4. Move + collide, axis by axis.
  let grounded = false;

  // Y first.
  p[1] += v[1] * dt;
  if (collides(world, p[0], p[1], p[2])) {
    if (v[1] < 0) { p[1] = Math.floor(p[1] - EYE) + 1 + EYE; grounded = true; } // land: snap to surface
    else { p[1] -= v[1] * dt; } // ceiling: revert
    v[1] = 0;
  }

  // X with auto-step.
  p[0] += v[0] * dt;
  if (collides(world, p[0], p[1], p[2])) {
    let stepped = false;
    if (grounded) {
      p[1] += STEP;
      if (!collides(world, p[0], p[1], p[2])) stepped = true; else p[1] -= STEP;
    }
    if (!stepped) { p[0] -= v[0] * dt; v[0] = 0; }
  }

  // Z with auto-step.
  p[2] += v[2] * dt;
  if (collides(world, p[0], p[1], p[2])) {
    let stepped = false;
    if (grounded) {
      p[1] += STEP;
      if (!collides(world, p[0], p[1], p[2])) stepped = true; else p[1] -= STEP;
    }
    if (!stepped) { p[2] -= v[2] * dt; v[2] = 0; }
  }

  cam.grounded = grounded;
  return cam;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/walk-camera.test.js`
Expected: PASS — both tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/player/walk-camera.js test/walk-camera.test.js
git commit -m "feat(player): walk-camera with gravity + ground snap (explore mode physics)"
```

---

## Task 2: walk-camera — jump, auto-step, and wall collision

**Files:**
- Modify: `test/walk-camera.test.js`
- (No implementation change expected — Task 1's module already covers these; these tests lock the behavior.)

- [ ] **Step 1: Add the failing/locking tests**

Append these `it(...)` blocks inside the `describe('walk-camera', ...)` in `test/walk-camera.test.js`:

```js
  it('jumps only when grounded', () => {
    const w = createWorld(); fillFloor(w, 8);
    const cam = cameraAt(10, 2.6, 10); cam.grounded = true;
    const JUMP = { forward: 0, strafe: 0, vertical: 1, dYaw: 0, dPitch: 0 };
    updateWalkCamera(cam, JUMP, 0.016, w);
    expect(cam.pos[1]).toBeGreaterThan(2.6); // launched upward
    const risingVel = cam.vel[1];
    expect(risingVel).toBeGreaterThan(8); // ~JUMP_VEL, still rising
    // Airborne now (cam.grounded is false); holding jump must NOT re-launch.
    updateWalkCamera(cam, JUMP, 0.016, w);
    expect(cam.vel[1]).toBeLessThan(risingVel); // only gravity acted, no reset to JUMP_VEL
  });

  it('auto-climbs a 1-high step while walking into it', () => {
    const w = createWorld(); fillFloor(w, 8);
    for (let z = 9; z <= 11; z++) setBlock(w, 12, 1, z, 5); // 1-high step at x=12
    const cam = cameraAt(10.5, 2.6, 10.5, Math.PI / 2); cam.grounded = true; // yaw=PI/2 -> forward is +x
    const FWD = { forward: 1, strafe: 0, vertical: 0, dYaw: 0, dPitch: 0 };
    for (let i = 0; i < 120; i++) updateWalkCamera(cam, FWD, 0.016, w);
    expect(cam.pos[1]).toBeGreaterThan(3.4); // climbed: feet now on the block top (y=2), eye ~3.6
    expect(cam.pos[0]).toBeGreaterThan(12);  // walked up and onto the block
  });

  it('a 2-high wall blocks movement (no climb)', () => {
    const w = createWorld(); fillFloor(w, 8);
    for (let y = 1; y <= 2; y++) for (let z = 9; z <= 11; z++) setBlock(w, 12, y, z, 5); // 2-high wall
    const cam = cameraAt(10.5, 2.6, 10.5, Math.PI / 2); cam.grounded = true;
    const FWD = { forward: 1, strafe: 0, vertical: 0, dYaw: 0, dPitch: 0 };
    for (let i = 0; i < 120; i++) updateWalkCamera(cam, FWD, 0.016, w);
    expect(cam.pos[0]).toBeLessThan(11.8); // stopped at the wall
    expect(cam.pos[1]).toBeLessThan(3.0);  // did NOT climb (still ~2.6)
  });
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run test/walk-camera.test.js`
Expected: PASS — all 5 tests green (the Task 1 module already implements jump/step/wall). If any fail, fix `lib/player/walk-camera.js` to satisfy them (do not weaken the tests).

- [ ] **Step 3: Run the full suite to confirm no regressions**

Run: `npm test`
Expected: PASS — all suites green.

- [ ] **Step 4: Commit**

```bash
git add test/walk-camera.test.js
git commit -m "test(player): lock walk-camera jump, auto-step, and wall behavior"
```

---

## Task 3: Mode toggle button in the HUD

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add the `#modeBtn` button to the topbar**

In `index.html`, find the topbar right-side group:

```html
    <div style="display:flex;align-items:center;gap:8px">
      <button id="outlineBtn" title="Toggle cube outlines" style="pointer-events:auto;background:rgba(0,0,0,.35);border:0;color:#fff;border-radius:8px;padding:6px 10px;font-size:16px;line-height:1">▦</button>
      <span id="ver" style="opacity:.8;font-size:13px">v0.5.10</span>
    </div>
```

Replace it with (adds `#modeBtn` before the outline button):

```html
    <div style="display:flex;align-items:center;gap:8px">
      <button id="modeBtn" title="Toggle fly / walk" style="pointer-events:auto;background:rgba(0,0,0,.35);border:0;color:#fff;border-radius:8px;padding:6px 10px;font-size:14px;font-weight:600;line-height:1">Fly</button>
      <button id="outlineBtn" title="Toggle cube outlines" style="pointer-events:auto;background:rgba(0,0,0,.35);border:0;color:#fff;border-radius:8px;padding:6px 10px;font-size:16px;line-height:1">▦</button>
      <span id="ver" style="opacity:.8;font-size:13px">v0.5.10</span>
    </div>
```

- [ ] **Step 2: Sanity-check the HTML is well-formed**

Run: `node -e "const s=require('fs').readFileSync('index.html','utf8'); if(!s.includes('id=\"modeBtn\"')) throw new Error('modeBtn missing'); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(ui): add Fly/Walk mode toggle button to the topbar"
```

---

## Task 4: Wire the mode into main.js (loop, build gate, toggle)

**Files:**
- Modify: `main.js`

- [ ] **Step 1: Import `updateWalkCamera`**

In `main.js`, change the fly-camera import line:

```js
import { createFlyCamera, updateFlyCamera, lookDir } from './lib/player/fly-camera.js';
```

to:

```js
import { createFlyCamera, updateFlyCamera, lookDir } from './lib/player/fly-camera.js';
import { updateWalkCamera } from './lib/player/walk-camera.js';
```

- [ ] **Step 2: Add the `mode` state and the toggle button wiring**

In `runGame`, the cube-outline button block ends like this:

```js
    outlineBtn.addEventListener('click', () => {
      const next = !view.getOutlines();
      view.setOutlines(next);
      try { localStorage.setItem('blockworld:outlines', next ? '1' : '0'); } catch (e) {}
      paintOutlineBtn();
    });
  }
```

Immediately AFTER that closing `}` (the end of the `if (outlineBtn) { ... }` block), insert:

```js
  // Edit (fly) vs Explore (walk). Edit is the default; Explore is move-only.
  let mode = 'edit';
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
```

- [ ] **Step 3: Gate building to Edit mode**

In `main.js`, change the start of `act()`:

```js
  function act() {
    if (!session.canEditLocal()) return;
```

to:

```js
  function act() {
    if (mode !== 'edit') return; // Explore is move-only
    if (!session.canEditLocal()) return;
```

- [ ] **Step 4: Branch the loop's camera update and gate the highlight**

In the `loop` function, replace:

```js
    updateFlyCamera(cam, intent, dt);
```

with:

```js
    if (mode === 'explore') updateWalkCamera(cam, intent, dt, world); else updateFlyCamera(cam, intent, dt);
```

Then replace:

```js
    const target = raycast(world, cam.pos, lookDir(cam), REACH);
    view.setHighlight(target ? target.cell : null);
```

with:

```js
    const target = mode === 'edit' ? raycast(world, cam.pos, lookDir(cam), REACH) : null;
    view.setHighlight(target ? target.cell : null);
```

- [ ] **Step 5: Sanity-check and run the suite**

Run: `node --check main.js && npm test 2>&1 | tail -3`
Expected: parses OK; all tests pass (the 5 walk-camera tests included).

- [ ] **Step 6: Commit**

```bash
git add main.js
git commit -m "feat: wire explore (walk) mode — loop branch, build gate, toggle"
```

---

## Task 5: Verify and version bump

**Files:**
- Modify: `index.html`, `package.json`

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: PASS — all suites green, including 5 `walk-camera` tests.

- [ ] **Step 2: Headless smoke (boots without errors)**

Run: `npm run smoke`
Expected: `SMOKE OK — main menu rendered, no page errors`.

- [ ] **Step 3: Manual check via the dev server**

Run `npm run dev`, open the URL, create/open a world, then:
1. Topbar shows a **Fly** button. Default movement is flying (no gravity).
2. Tap it → label becomes **Walk**; the camera falls and lands on the floor; WASD/joystick walks; Space / ▲ jumps; you cannot place/remove blocks and the crosshair highlight is gone.
3. Walk into a 1-high block → you step up onto it. Walk into a 2-high wall → you stop.
4. Tap **Walk** → back to **Fly**; flying and building work again.
Stop the dev server when done.

- [ ] **Step 4: Bump the version to v0.5.11**

In `index.html`, replace both `v0.5.10` occurrences (the `<meta name="game-version">` and the `#ver` span) with `v0.5.11`. In `package.json`, replace `"version": "0.5.10",` with `"version": "0.5.11",`.

- [ ] **Step 5: Commit**

```bash
git add index.html package.json
git commit -m "chore: explore (walk) mode complete; v0.5.11"
```

---

## Self-Review

**Spec coverage:**
- Modes + default Edit + zero velocity on switch (spec §2) → Task 4 Steps 2.
- Fly/Walk toggle button top-right (§2) → Task 3 + Task 4 Step 2.
- Explore move-only: build gated + highlight hidden (§2) → Task 4 Steps 3–4.
- Walk physics: body, constants, horizontal, gravity, jump, per-axis collide, snap-on-landing, auto-step (§3) → Task 1 module (+ Task 2 tests).
- Loop branch / `act()` gate / highlight gate / import / avatars unchanged (§4) → Task 4.
- Tests: fall, land, jump-when-grounded, auto-step, wall (§5) → Tasks 1–2.

**Placeholder scan:** None — every code/test step shows complete code; commands have expected output.

**Type/name consistency:** `updateWalkCamera(cam, intent, dt, world)` defined in Task 1 is imported and called identically in Task 4. `cam.grounded` is written by the module (Task 1) and reset on toggle (Task 4). `mode` (`'edit'|'explore'`) is used consistently across the loop, `act()`, highlight, and toggle. Camera shape `{pos,yaw,pitch,vel,grounded}` matches the fly camera plus the added `grounded`. Intent fields (`forward/strafe/vertical/dYaw/dPitch`) match what `pollIntent` already produces.
