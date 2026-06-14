# BlockWorld Plan 1 — Solo Creative Sandbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A playable, persistent single-player creative voxel sandbox — fly through a fixed 128×128×64 world and place/break 16-color blocks, on desktop and mobile.

**Architecture:** Pure data/logic modules (voxel store, RLE, mesher, raycast, fly-camera, edit) are headless and unit-tested with vitest. A thin three.js layer (world-view, avatars later) renders chunk meshes with one shared vertex-colored material and rebuilds only dirty chunks. Input modules turn keyboard/mouse/touch into intents; `main.js` wires the loop and PlaySDK persistence. No build step — ES modules + a vendored UMD three.js (global `THREE`).

**Tech Stack:** Vanilla ES modules, three.js r128 (vendored), PlaySDK (save/load, onPause/onResume), vitest for unit tests, Puppeteer for a headless render smoke check. Dev server on port **8093**.

This plan is Plan 1 of the BlockWorld build. It implements the solo foundation from the spec
(`docs/superpowers/specs/2026-06-14-blockworld-multiplayer-builder-design.md`) sections 6, 7, 8 and
the single-player slice of 9. Multiplayer (spec §4–5, avatars, grants, share/join menus) is Plan 2.

**Plan-level decisions (refining the spec):**
- **AO:** implemented as standard per-vertex corner AO baked into vertex color (spec §6). Combined with
  a `MeshLambertMaterial` + one directional light, this gives the chosen "solid flat-shaded" look.
- **Persistence in Plan 1:** a single world under key `world:current` (load on start, debounced
  autosave). The multi-world `worlds-index` + "My Worlds" menu lands in Plan 2 where create/join lives.
- **Coordinate convention (fixed for the whole codebase):** `x` = width (0..127), `z` = length
  (0..127), `y` = height (0..63). Flat array index `idx = x + z*128 + y*128*128`.

---

## File Structure

```
BlockWorld/
  index.html              entry point (canvas, HUD DOM, script tags)
  meta.json               platform metadata (slug blockworld, desktop_fill true)
  thumbnail.png           512×512 — rendered from the real game before deploy (placeholder for now)
  main.js                 wiring: loop, PlaySDK lifecycle, glue
  vendor/three.min.js     three.js r128 UMD (global THREE)
  lib/
    constants.js          world dims, chunk size, index helpers
    palette.js            16 colors as hex + normalized rgb
    voxel/
      store.js            Uint8Array world; get/set/bounds; flat-floor gen
      rle.js              store ⇄ base64 RLE string
      mesher.js           pure: (store, chunk coords) → {positions,colors,normals,indices}
      raycast.js          pure: DDA ray → {cell, normal} | null
      edit.js             pure: apply place/break → mutated cells + dirty chunk ids
    render/
      world-view.js       three.js scene/renderer; chunk meshes; dirty re-mesh; lights/fog
    player/
      fly-camera.js       pure-ish: intents + dt → position/orientation
    input/
      desktop.js          pointer-lock, WASD, mouse-look, click → intents
      mobile.js           joystick, drag-look, fly/place/break buttons → intents
    ui/
      hud.js              crosshair, palette strip, mobile buttons, version stamp
    persist/
      world-store.js      PlaySDK save/load of the current world; autosave debounce
  test/
    *.test.js             vitest unit tests for the pure modules
  scripts/
    dev-server.mjs        static server on :8093
    smoke.mjs             Puppeteer: load game headless, assert canvas renders, grab thumbnail
  package.json
  vitest.config.js
```

---

## Task 0: Project scaffold

**Files:**
- Create: `package.json`, `vitest.config.js`, `meta.json`, `index.html`, `lib/constants.js`,
  `scripts/dev-server.mjs`, `vendor/three.min.js`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "blockworld",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "node scripts/dev-server.mjs",
    "test": "vitest run",
    "smoke": "node scripts/smoke.mjs"
  },
  "devDependencies": {
    "vitest": "^2.1.0",
    "puppeteer": "^23.0.0"
  }
}
```

- [ ] **Step 2: Create `vitest.config.js`**

```js
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['test/**/*.test.js'] } });
```

- [ ] **Step 3: Install deps and vendor three.js r128**

Run:
```bash
cd /Users/nitzanwilnai/Programming/Claude/JSGames/BlockWorld
npm install
mkdir -p vendor lib/voxel lib/render lib/player lib/input lib/ui lib/persist test scripts
curl -sL https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js -o vendor/three.min.js
test -s vendor/three.min.js && echo "three vendored: $(wc -c < vendor/three.min.js) bytes"
```
Expected: prints a byte count > 500000.

- [ ] **Step 4: Create `lib/constants.js`**

```js
// World is fixed-size. x=width, z=length, y=height.
export const WX = 128, WZ = 128, WY = 64;
export const CHUNK = 16;
export const NCX = WX / CHUNK, NCY = WY / CHUNK, NCZ = WZ / CHUNK; // 8,4,8
export const VOXELS = WX * WZ * WY; // 1,048,576

export function idx(x, y, z) { return x + z * WX + y * WX * WZ; }
export function inBounds(x, y, z) {
  return x >= 0 && x < WX && y >= 0 && y < WY && z >= 0 && z < WZ;
}
// chunk id from chunk coords and back
export function chunkId(cx, cy, cz) { return cx + cz * NCX + cy * NCX * NCZ; }
```

- [ ] **Step 5: Create `meta.json`**

```json
{
  "slug": "blockworld",
  "title": "BlockWorld",
  "description": "Build anything from colored blocks in a shared world.",
  "tags": ["creative", "sandbox", "multiplayer"],
  "author": "Nitzan",
  "thumbnail": "thumbnail.png",
  "desktop_fill": true
}
```

- [ ] **Step 6: Create `scripts/dev-server.mjs`**

```js
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
const ROOT = process.cwd();
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.json':'application/json',
  '.png':'image/png', '.mjs':'text/javascript' };
createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = normalize(join(ROOT, p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('not found'); }
}).listen(8093, () => console.log('BlockWorld dev → http://localhost:8093'));
```

- [ ] **Step 7: Create minimal `index.html`** (placeholder; HUD DOM added in Task 12)

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
<meta name="game-version" content="v0.1.0">
<title>BlockWorld</title>
<style>html,body{margin:0;height:100%;overflow:hidden;background:#9ec7e8;touch-action:none}#c{display:block;width:100%;height:100%}</style>
</head>
<body>
<canvas id="c"></canvas>
<script src="https://nitzan.games/play-sdk.js"></script>
<script src="vendor/three.min.js"></script>
<script type="module" src="main.js"></script>
</body>
</html>
```

- [ ] **Step 8: Create placeholder `main.js`**

```js
// Filled in incrementally. For now, prove three.js + canvas are wired.
const THREE = window.THREE;
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('c') });
renderer.setClearColor(0x9ec7e8);
renderer.setSize(window.innerWidth, window.innerHeight, false);
```

- [ ] **Step 9: Verify dev server + git ignore vendor build, then commit**

Run: `npm run dev` then in another shell `curl -s localhost:8093/ | grep -c BlockWorld` → expect `1`. Stop the server.
Add `vendor/` is committed (it's a dependency, keep it). Then:
```bash
git add package.json vitest.config.js meta.json index.html main.js lib/constants.js scripts/dev-server.mjs vendor/three.min.js
git commit -m "chore: scaffold BlockWorld solo builder (deps, dev server, three r128, constants)"
```

---

## Task 1: Voxel store

**Files:**
- Create: `lib/voxel/store.js`, `test/store.test.js`

- [ ] **Step 1: Write failing test — `test/store.test.js`**

```js
import { describe, it, expect } from 'vitest';
import { createWorld, getBlock, setBlock, fillFloor } from '../lib/voxel/store.js';
import { WX, WZ, WY, VOXELS } from '../lib/constants.js';

describe('voxel store', () => {
  it('creates an all-air world of the right size', () => {
    const w = createWorld();
    expect(w.length).toBe(VOXELS);
    expect(getBlock(w, 5, 5, 5)).toBe(0);
  });
  it('sets and gets a block', () => {
    const w = createWorld();
    setBlock(w, 10, 2, 3, 7);
    expect(getBlock(w, 10, 2, 3)).toBe(7);
  });
  it('treats out-of-bounds reads as air and ignores oob writes', () => {
    const w = createWorld();
    expect(getBlock(w, -1, 0, 0)).toBe(0);
    expect(getBlock(w, WX, 0, 0)).toBe(0);
    expect(setBlock(w, -1, 0, 0, 5)).toBe(false);
    expect(setBlock(w, 0, WY, 0, 5)).toBe(false);
  });
  it('fillFloor lays one solid layer at y=0', () => {
    const w = createWorld();
    fillFloor(w, 8); // grass index 8
    expect(getBlock(w, 0, 0, 0)).toBe(8);
    expect(getBlock(w, WX - 1, 0, WZ - 1)).toBe(8);
    expect(getBlock(w, 0, 1, 0)).toBe(0);
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `npm test -- store` → Expected: FAIL (module not found / functions undefined).

- [ ] **Step 3: Implement `lib/voxel/store.js`**

```js
import { VOXELS, WX, WZ, WY, idx, inBounds } from '../constants.js';

export function createWorld() { return new Uint8Array(VOXELS); }

export function getBlock(w, x, y, z) {
  if (!inBounds(x, y, z)) return 0;
  return w[idx(x, y, z)];
}

export function setBlock(w, x, y, z, b) {
  if (!inBounds(x, y, z)) return false;
  w[idx(x, y, z)] = b & 0xff;
  return true;
}

export function fillFloor(w, colorIndex) {
  for (let z = 0; z < WZ; z++)
    for (let x = 0; x < WX; x++)
      w[idx(x, 0, z)] = colorIndex & 0xff;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test -- store` → Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/voxel/store.js test/store.test.js
git commit -m "feat(voxel): bounded Uint8Array world store with get/set/fillFloor"
```

---

## Task 2: RLE serialization

**Files:**
- Create: `lib/voxel/rle.js`, `test/rle.test.js`

- [ ] **Step 1: Write failing test — `test/rle.test.js`**

```js
import { describe, it, expect } from 'vitest';
import { createWorld, setBlock, getBlock, fillFloor } from '../lib/voxel/store.js';
import { serialize, deserialize } from '../lib/voxel/rle.js';
import { VOXELS } from '../lib/constants.js';

describe('rle', () => {
  it('round-trips an all-air world to a tiny string', () => {
    const w = createWorld();
    const s = serialize(w);
    expect(typeof s).toBe('string');
    expect(s.length).toBeLessThan(50); // one giant air run
    const w2 = deserialize(s);
    expect(w2.length).toBe(VOXELS);
    expect(getBlock(w2, 0, 0, 0)).toBe(0);
  });
  it('round-trips a built world exactly', () => {
    const w = createWorld();
    fillFloor(w, 8);
    setBlock(w, 1, 1, 1, 4);
    setBlock(w, 1, 2, 1, 4);
    setBlock(w, 5, 1, 9, 11);
    const w2 = deserialize(serialize(w));
    for (let i = 0; i < VOXELS; i++) expect(w2[i]).toBe(w[i]);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test -- rle` → Expected: FAIL.

- [ ] **Step 3: Implement `lib/voxel/rle.js`**

Format: a sequence of runs `[blockType byte][count as LEB128 varint]` over the flat array, then
bytes → base64. Counts use varint so a full-world air run (1,048,576) fits in 3 bytes.

```js
import { VOXELS as N } from '../constants.js';

function pushVarint(arr, n) {
  do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; arr.push(b); } while (n);
}
function readVarint(bytes, posRef) {
  let n = 0, shift = 0, b;
  do { b = bytes[posRef.p++]; n |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
  return n >>> 0;
}
function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function b64ToBytes(b64) {
  const bin = atob(b64), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function serialize(w) {
  const out = [];
  let i = 0;
  while (i < N) {
    const v = w[i]; let run = 1;
    while (i + run < N && w[i + run] === v) run++;
    out.push(v); pushVarint(out, run);
    i += run;
  }
  return bytesToB64(Uint8Array.from(out));
}

export function deserialize(b64) {
  const bytes = b64ToBytes(b64);
  const w = new Uint8Array(N);
  const ref = { p: 0 }; let i = 0;
  while (ref.p < bytes.length && i < N) {
    const v = bytes[ref.p++];
    const run = readVarint(bytes, ref);
    w.fill(v, i, i + run);
    i += run;
  }
  return w;
}
```

Note: `btoa`/`atob` exist in browsers and in Node ≥16 global scope, so vitest (Node) runs them fine.

- [ ] **Step 4: Run, verify pass**

Run: `npm test -- rle` → Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/voxel/rle.js test/rle.test.js
git commit -m "feat(voxel): RLE+varint+base64 world (de)serialization with exact round-trip"
```

---

## Task 3: Palette

**Files:**
- Create: `lib/palette.js`, `test/palette.test.js`

- [ ] **Step 1: Write failing test — `test/palette.test.js`**

```js
import { describe, it, expect } from 'vitest';
import { PALETTE_HEX, PALETTE_RGB } from '../lib/palette.js';

describe('palette', () => {
  it('has 16 colors plus an air slot at index 0', () => {
    expect(PALETTE_HEX.length).toBe(17);
    expect(PALETTE_RGB.length).toBe(17);
  });
  it('normalizes rgb to 0..1', () => {
    // index 1 = #E9ECEC
    const [r, g, b] = PALETTE_RGB[1];
    expect(r).toBeCloseTo(0xE9 / 255, 5);
    expect(g).toBeCloseTo(0xEC / 255, 5);
    expect(b).toBeCloseTo(0xEC / 255, 5);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test -- palette` → Expected: FAIL.

- [ ] **Step 3: Implement `lib/palette.js`**

```js
// Index 0 = air (unused color slot kept for 1:1 index alignment with block bytes).
export const PALETTE_HEX = [
  '#000000', // 0 air (never rendered)
  '#E9ECEC','#8E8E86','#3B4044','#1D1C21','#B02E26','#F07613','#F8C627','#5EA918',
  '#5E7C16','#157788','#3AAFD9','#3C44AA','#8932B8','#BD44B3','#ED8DAC','#835432'
];
export const PALETTE_RGB = PALETTE_HEX.map((h) => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
});
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test -- palette` → Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/palette.js test/palette.test.js
git commit -m "feat: 16-color palette (hex + normalized rgb)"
```

---

## Task 4: Chunk mesher (culled faces + AO + vertex color)

**Files:**
- Create: `lib/voxel/mesher.js`, `test/mesher.test.js`

This is the core renderer input. Pure function: given the world and a chunk's coords, return typed
arrays for a `THREE.BufferGeometry`. Faces are emitted only where a solid block touches air/edge.
Each vertex carries the block's palette color multiplied by a corner-AO brightness.

- [ ] **Step 1: Write failing test — `test/mesher.test.js`**

```js
import { describe, it, expect } from 'vitest';
import { createWorld, setBlock } from '../lib/voxel/store.js';
import { meshChunk } from '../lib/voxel/mesher.js';

describe('mesher', () => {
  it('an isolated block in chunk 0 emits 6 faces (24 verts, 36 indices)', () => {
    const w = createWorld();
    setBlock(w, 2, 2, 2, 5);
    const g = meshChunk(w, 0, 0, 0);
    expect(g.positions.length).toBe(24 * 3);
    expect(g.indices.length).toBe(6 * 6);
    expect(g.colors.length).toBe(24 * 3);
    expect(g.normals.length).toBe(24 * 3);
  });
  it('two adjacent blocks cull the shared pair of faces (10 faces total)', () => {
    const w = createWorld();
    setBlock(w, 2, 2, 2, 5);
    setBlock(w, 3, 2, 2, 5);
    const g = meshChunk(w, 0, 0, 0);
    expect(g.indices.length).toBe(10 * 6); // 12 - 2 shared
  });
  it('empty chunk emits nothing', () => {
    const w = createWorld();
    const g = meshChunk(w, 0, 0, 0);
    expect(g.indices.length).toBe(0);
  });
  it('AO darkens a face vertex that has solid neighbors vs an isolated one', () => {
    const iso = createWorld(); setBlock(iso, 2, 2, 2, 1);
    const gi = meshChunk(iso, 0, 0, 0);
    const occ = createWorld();
    setBlock(occ, 2, 2, 2, 1);   // the block
    setBlock(occ, 2, 3, 2, 1);   // neighbor above
    setBlock(occ, 3, 3, 2, 1);   // diagonal — occludes a top-face corner of (2,2,2)? top is covered, test +X face instead
    setBlock(occ, 3, 2, 2, 0);
    const go = meshChunk(occ, 0, 0, 0);
    // brightest vertex color in occluded mesh should be <= brightest in isolated mesh
    const maxIso = Math.max(...gi.colors);
    const maxOcc = Math.max(...go.colors);
    expect(maxOcc).toBeLessThanOrEqual(maxIso);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test -- mesher` → Expected: FAIL.

- [ ] **Step 3: Implement `lib/voxel/mesher.js`**

```js
import { CHUNK, WX, WY, WZ } from '../constants.js';
import { PALETTE_RGB } from '../palette.js';

// A solid lookup that is safe out of bounds (treats oob as air → faces on world edges show).
function solid(w, x, y, z) {
  if (x < 0 || x >= WX || y < 0 || y >= WY || z < 0 || z >= WZ) return 0;
  return w[x + z * WX + y * WX * WZ];
}

// 6 faces. For each: face normal dir, the 4 corner offsets (CCW seen from outside),
// and for each corner the two in-plane neighbor offsets (side1, side2) + the diagonal (corner)
// used for ambient occlusion. Offsets are relative to the *air* cell (block + dir).
const FACES = [
  { dir: [ 1, 0, 0], corners: [ [1,0,0],[1,1,0],[1,1,1],[1,0,1] ],
    ao: [ [[0,-1,0],[0,0,-1],[0,-1,-1]], [[0,1,0],[0,0,-1],[0,1,-1]], [[0,1,0],[0,0,1],[0,1,1]], [[0,-1,0],[0,0,1],[0,-1,1]] ] },
  { dir: [-1, 0, 0], corners: [ [0,0,1],[0,1,1],[0,1,0],[0,0,0] ],
    ao: [ [[0,-1,0],[0,0,1],[0,-1,1]], [[0,1,0],[0,0,1],[0,1,1]], [[0,1,0],[0,0,-1],[0,1,-1]], [[0,-1,0],[0,0,-1],[0,-1,-1]] ] },
  { dir: [0, 1, 0], corners: [ [0,1,1],[1,1,1],[1,1,0],[0,1,0] ],
    ao: [ [[-1,0,0],[0,0,1],[-1,0,1]], [[1,0,0],[0,0,1],[1,0,1]], [[1,0,0],[0,0,-1],[1,0,-1]], [[-1,0,0],[0,0,-1],[-1,0,-1]] ] },
  { dir: [0,-1, 0], corners: [ [0,0,0],[1,0,0],[1,0,1],[0,0,1] ],
    ao: [ [[-1,0,0],[0,0,-1],[-1,0,-1]], [[1,0,0],[0,0,-1],[1,0,-1]], [[1,0,0],[0,0,1],[1,0,1]], [[-1,0,0],[0,0,1],[-1,0,1]] ] },
  { dir: [0, 0, 1], corners: [ [1,0,1],[1,1,1],[0,1,1],[0,0,1] ],
    ao: [ [[1,0,0],[0,-1,0],[1,-1,0]], [[1,0,0],[0,1,0],[1,1,0]], [[-1,0,0],[0,1,0],[-1,1,0]], [[-1,0,0],[0,-1,0],[-1,-1,0]] ] },
  { dir: [0, 0,-1], corners: [ [0,0,0],[0,1,0],[1,1,0],[1,0,0] ],
    ao: [ [[-1,0,0],[0,-1,0],[-1,-1,0]], [[-1,0,0],[0,1,0],[-1,1,0]], [[1,0,0],[0,1,0],[1,1,0]], [[1,0,0],[0,-1,0],[1,-1,0]] ] },
];

// AO brightness per corner: classic 0..3 → 0.45 .. 1.0
const AO_LEVELS = [0.45, 0.65, 0.82, 1.0];
function aoBrightness(w, ax, ay, az, tri) {
  // ax,ay,az = the air cell; tri = [side1, side2, corner] offsets relative to air cell
  const s1 = solid(w, ax + tri[0][0], ay + tri[0][1], az + tri[0][2]) ? 1 : 0;
  const s2 = solid(w, ax + tri[1][0], ay + tri[1][1], az + tri[1][2]) ? 1 : 0;
  const c  = solid(w, ax + tri[2][0], ay + tri[2][1], az + tri[2][2]) ? 1 : 0;
  const level = (s1 && s2) ? 0 : (3 - (s1 + s2 + c));
  return AO_LEVELS[level];
}

export function meshChunk(w, cx, cy, cz) {
  const positions = [], colors = [], normals = [], indices = [];
  const x0 = cx * CHUNK, y0 = cy * CHUNK, z0 = cz * CHUNK;
  let vbase = 0;
  for (let y = y0; y < y0 + CHUNK; y++)
    for (let z = z0; z < z0 + CHUNK; z++)
      for (let x = x0; x < x0 + CHUNK; x++) {
        const b = solid(w, x, y, z);
        if (!b) continue;
        const rgb = PALETTE_RGB[b];
        for (let f = 0; f < 6; f++) {
          const fd = FACES[f].dir;
          if (solid(w, x + fd[0], y + fd[1], z + fd[2])) continue; // face hidden
          const ax = x + fd[0], ay = y + fd[1], az = z + fd[2];    // air cell for AO sampling
          for (let ci = 0; ci < 4; ci++) {
            const co = FACES[f].corners[ci];
            positions.push(x + co[0], y + co[1], z + co[2]);
            normals.push(fd[0], fd[1], fd[2]);
            const ao = aoBrightness(w, ax, ay, az, FACES[f].ao[ci]);
            colors.push(rgb[0] * ao, rgb[1] * ao, rgb[2] * ao);
          }
          indices.push(vbase, vbase + 1, vbase + 2, vbase, vbase + 2, vbase + 3);
          vbase += 4;
        }
      }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Float32Array(colors),
    indices: new Uint32Array(indices),
  };
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test -- mesher` → Expected: PASS (4 tests). If the AO test is flaky on the exact neighbor
chosen, the assertion only requires `maxOcc <= maxIso`, which holds because adding any solid neighbor
can only lower some corner's brightness and never raises one.

- [ ] **Step 5: Commit**

```bash
git add lib/voxel/mesher.js test/mesher.test.js
git commit -m "feat(voxel): pure chunk mesher with culled faces, corner AO, vertex colors"
```

---

## Task 5: Voxel raycast (DDA)

**Files:**
- Create: `lib/voxel/raycast.js`, `test/raycast.test.js`

- [ ] **Step 1: Write failing test — `test/raycast.test.js`**

```js
import { describe, it, expect } from 'vitest';
import { createWorld, setBlock } from '../lib/voxel/store.js';
import { raycast } from '../lib/voxel/raycast.js';

describe('raycast', () => {
  it('hits the first solid block along +x and reports the -x face', () => {
    const w = createWorld();
    setBlock(w, 5, 0, 0, 3);
    const hit = raycast(w, [0.5, 0.5, 0.5], [1, 0, 0], 16);
    expect(hit).not.toBeNull();
    expect(hit.cell).toEqual([5, 0, 0]);
    expect(hit.normal).toEqual([-1, 0, 0]);
  });
  it('returns null when nothing is within range', () => {
    const w = createWorld();
    setBlock(w, 50, 0, 0, 3);
    expect(raycast(w, [0.5, 0.5, 0.5], [1, 0, 0], 8)).toBeNull();
  });
  it('hits a block from above reporting the +y face', () => {
    const w = createWorld();
    setBlock(w, 2, 0, 2, 8);
    const hit = raycast(w, [2.5, 5, 2.5], [0, -1, 0], 16);
    expect(hit.cell).toEqual([2, 0, 2]);
    expect(hit.normal).toEqual([0, 1, 0]);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test -- raycast` → Expected: FAIL.

- [ ] **Step 3: Implement `lib/voxel/raycast.js`** (Amanatides–Woo grid traversal)

```js
import { getBlock } from './store.js';

// origin: world-space [x,y,z] (block units). dir: normalized [x,y,z]. maxDist in blocks.
// Returns { cell:[x,y,z], normal:[x,y,z] } of the first solid voxel, or null.
export function raycast(w, origin, dir, maxDist) {
  let x = Math.floor(origin[0]), y = Math.floor(origin[1]), z = Math.floor(origin[2]);
  const stepX = Math.sign(dir[0]), stepY = Math.sign(dir[1]), stepZ = Math.sign(dir[2]);
  const tDeltaX = dir[0] !== 0 ? Math.abs(1 / dir[0]) : Infinity;
  const tDeltaY = dir[1] !== 0 ? Math.abs(1 / dir[1]) : Infinity;
  const tDeltaZ = dir[2] !== 0 ? Math.abs(1 / dir[2]) : Infinity;
  const distToBound = (o, s) => s > 0 ? (Math.floor(o) + 1 - o) : (o - Math.floor(o));
  let tMaxX = dir[0] !== 0 ? distToBound(origin[0], stepX) * tDeltaX : Infinity;
  let tMaxY = dir[1] !== 0 ? distToBound(origin[1], stepY) * tDeltaY : Infinity;
  let tMaxZ = dir[2] !== 0 ? distToBound(origin[2], stepZ) * tDeltaZ : Infinity;
  let normal = [0, 0, 0];
  let t = 0;
  // check the starting cell first
  if (getBlock(w, x, y, z)) return { cell: [x, y, z], normal: [0, 0, 0] };
  while (t <= maxDist) {
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX; t = tMaxX; tMaxX += tDeltaX; normal = [-stepX, 0, 0];
    } else if (tMaxY < tMaxZ) {
      y += stepY; t = tMaxY; tMaxY += tDeltaY; normal = [0, -stepY, 0];
    } else {
      z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; normal = [0, 0, -stepZ];
    }
    if (t > maxDist) break;
    if (getBlock(w, x, y, z)) return { cell: [x, y, z], normal };
  }
  return null;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test -- raycast` → Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/voxel/raycast.js test/raycast.test.js
git commit -m "feat(voxel): DDA voxel raycast returning hit cell + face normal"
```

---

## Task 6: Edit logic (place/break → dirty chunks)

**Files:**
- Create: `lib/voxel/edit.js`, `test/edit.test.js`

- [ ] **Step 1: Write failing test — `test/edit.test.js`**

```js
import { describe, it, expect } from 'vitest';
import { createWorld, getBlock, setBlock } from '../lib/voxel/store.js';
import { applyEdit, dirtyChunksFor } from '../lib/voxel/edit.js';

describe('edit', () => {
  it('break clears the cell and returns its chunk id', () => {
    const w = createWorld();
    setBlock(w, 2, 2, 2, 5);
    const res = applyEdit(w, 2, 2, 2, 0);
    expect(res.ok).toBe(true);
    expect(getBlock(w, 2, 2, 2)).toBe(0);
    expect(res.dirty).toContain(0); // chunk (0,0,0)
  });
  it('place sets the cell', () => {
    const w = createWorld();
    const res = applyEdit(w, 4, 4, 4, 7);
    expect(res.ok).toBe(true);
    expect(getBlock(w, 4, 4, 4)).toBe(7);
  });
  it('editing a boundary block marks the neighbor chunk too', () => {
    const w = createWorld();
    const ids = dirtyChunksFor(15, 0, 0); // x=15 borders chunk 1 in x
    expect(ids).toContain(0);
    expect(ids).toContain(1);
  });
  it('rejects out-of-bounds edits', () => {
    const w = createWorld();
    expect(applyEdit(w, -1, 0, 0, 5).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test -- edit` → Expected: FAIL.

- [ ] **Step 3: Implement `lib/voxel/edit.js`**

```js
import { setBlock } from './store.js';
import { CHUNK, NCX, NCZ, inBounds, chunkId } from '../constants.js';

// Return the set of chunk ids whose mesh must rebuild after changing (x,y,z):
// the owning chunk, plus any neighbor chunk if the block sits on a chunk-boundary face.
export function dirtyChunksFor(x, y, z) {
  const ids = new Set();
  const add = (cx, cy, cz) => {
    if (cx < 0 || cy < 0 || cz < 0 || cx >= NCX || cz >= NCZ) return;
    ids.add(chunkId(cx, cy, cz));
  };
  const cx = (x / CHUNK) | 0, cy = (y / CHUNK) | 0, cz = (z / CHUNK) | 0;
  add(cx, cy, cz);
  if (x % CHUNK === 0) add(cx - 1, cy, cz);
  if (x % CHUNK === CHUNK - 1) add(cx + 1, cy, cz);
  if (y % CHUNK === 0) add(cx, cy - 1, cz);
  if (y % CHUNK === CHUNK - 1) add(cx, cy + 1, cz);
  if (z % CHUNK === 0) add(cx, cy, cz - 1);
  if (z % CHUNK === CHUNK - 1) add(cx, cy, cz + 1);
  return [...ids];
}

// block 0 = break, 1..16 = place that color. Returns {ok, dirty:[chunkId,...]}.
export function applyEdit(w, x, y, z, block) {
  if (!inBounds(x, y, z)) return { ok: false, dirty: [] };
  setBlock(w, x, y, z, block);
  return { ok: true, dirty: dirtyChunksFor(x, y, z) };
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test -- edit` → Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/voxel/edit.js test/edit.test.js
git commit -m "feat(voxel): apply place/break edits and compute dirty chunk ids"
```

---

## Task 7: Fly camera

**Files:**
- Create: `lib/player/fly-camera.js`, `test/fly-camera.test.js`

The camera holds position + yaw/pitch. It consumes per-frame intents and applies smoothed motion
(per the project rule that camera/input must lerp toward targets, not use raw accumulation).

- [ ] **Step 1: Write failing test — `test/fly-camera.test.js`**

```js
import { describe, it, expect } from 'vitest';
import { createFlyCamera, updateFlyCamera, lookDir } from '../lib/player/fly-camera.js';

describe('fly camera', () => {
  it('moving forward with yaw=0 increases +z (or -z) consistently with lookDir', () => {
    const cam = createFlyCamera([10, 10, 10], 0, 0);
    updateFlyCamera(cam, { forward: 1, strafe: 0, vertical: 0, dYaw: 0, dPitch: 0 }, 0.1);
    const d = lookDir(cam);
    // moved along the look direction's horizontal component
    expect(Math.sign(cam.pos[0] - 10)).toBe(Math.sign(d[0]) || 0);
    expect(Math.sign(cam.pos[2] - 10)).toBe(Math.sign(d[2]) || 0);
  });
  it('vertical intent changes y up', () => {
    const cam = createFlyCamera([0, 5, 0], 0, 0);
    updateFlyCamera(cam, { forward: 0, strafe: 0, vertical: 1, dYaw: 0, dPitch: 0 }, 0.1);
    expect(cam.pos[1]).toBeGreaterThan(5);
  });
  it('clamps pitch to just under +/- 90°', () => {
    const cam = createFlyCamera([0, 0, 0], 0, 0);
    for (let i = 0; i < 200; i++) updateFlyCamera(cam, { forward:0,strafe:0,vertical:0,dYaw:0,dPitch:1 }, 0.1);
    expect(cam.pitch).toBeLessThan(Math.PI / 2);
    expect(cam.pitch).toBeGreaterThan(Math.PI / 2 - 0.2);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test -- fly-camera` → Expected: FAIL.

- [ ] **Step 3: Implement `lib/player/fly-camera.js`**

```js
const SPEED = 14;          // blocks/sec
const PITCH_LIMIT = Math.PI / 2 - 0.01;

export function createFlyCamera(pos, yaw, pitch) {
  return { pos: [...pos], yaw, pitch, vel: [0, 0, 0] };
}

export function lookDir(cam) {
  const cp = Math.cos(cam.pitch);
  return [Math.sin(cam.yaw) * cp, Math.sin(cam.pitch), Math.cos(cam.yaw) * cp];
}

// intent: { forward, strafe, vertical in [-1,1]; dYaw, dPitch in radians }
export function updateFlyCamera(cam, intent, dt) {
  cam.yaw += intent.dYaw;
  cam.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, cam.pitch + intent.dPitch));
  // horizontal basis from yaw
  const fwd = [Math.sin(cam.yaw), 0, Math.cos(cam.yaw)];
  const right = [Math.cos(cam.yaw), 0, -Math.sin(cam.yaw)];
  const targetVel = [
    (fwd[0] * intent.forward + right[0] * intent.strafe) * SPEED,
    intent.vertical * SPEED,
    (fwd[2] * intent.forward + right[2] * intent.strafe) * SPEED,
  ];
  // smooth velocity toward target (exponential lerp) — avoids stutter from raw accumulation
  const k = 1 - Math.exp(-12 * dt);
  for (let i = 0; i < 3; i++) {
    cam.vel[i] += (targetVel[i] - cam.vel[i]) * k;
    cam.pos[i] += cam.vel[i] * dt;
  }
  return cam;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test -- fly-camera` → Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/player/fly-camera.js test/fly-camera.test.js
git commit -m "feat(player): smoothed creative fly camera (yaw/pitch + lerped velocity)"
```

---

## Task 8: three.js world view (renderer)

**Files:**
- Create: `lib/render/world-view.js`

Browser/WebGL module — verified by Puppeteer in Task 13, not unit-tested. Builds one `THREE.Mesh`
per chunk from `meshChunk`, with a single shared `MeshLambertMaterial({vertexColors:true})`. Exposes
`rebuildChunk(id)` for dirty re-meshing.

- [ ] **Step 1: Implement `lib/render/world-view.js`**

```js
import { meshChunk } from '../voxel/mesher.js';
import { NCX, NCY, NCZ, CHUNK, WX, WZ } from '../constants.js';

const THREE = window.THREE;

export function createWorldView(canvas, world) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isMobile() });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile() ? 1.5 : 2));
  renderer.setClearColor(0x9ec7e8);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x9ec7e8, 60, 180);
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 400);

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const sun = new THREE.DirectionalLight(0xffffff, 0.8);
  sun.position.set(0.5, 1, 0.3);
  scene.add(sun);

  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const meshes = new Map(); // chunkId → THREE.Mesh

  function chunkCoords(id) {
    const cx = id % NCX;
    const cz = ((id / NCX) | 0) % NCZ;
    const cy = (id / (NCX * NCZ)) | 0;
    return [cx, cy, cz];
  }

  function rebuildChunk(id) {
    const [cx, cy, cz] = chunkCoords(id);
    const g = meshChunk(world, cx, cy, cz);
    let mesh = meshes.get(id);
    if (g.indices.length === 0) {
      if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); meshes.delete(id); }
      return;
    }
    if (!mesh) {
      mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
      meshes.set(id, mesh); scene.add(mesh);
    }
    const geo = mesh.geometry;
    geo.setAttribute('position', new THREE.BufferAttribute(g.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(g.normals, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(g.colors, 3));
    geo.setIndex(new THREE.BufferAttribute(g.indices, 1));
    geo.computeBoundingSphere();
  }

  function rebuildAll() {
    for (let id = 0; id < NCX * NCY * NCZ; id++) rebuildChunk(id);
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize); resize();

  function render(cam) {
    camera.position.set(cam.pos[0], cam.pos[1], cam.pos[2]);
    const cp = Math.cos(cam.pitch);
    camera.lookAt(
      cam.pos[0] + Math.sin(cam.yaw) * cp,
      cam.pos[1] + Math.sin(cam.pitch),
      cam.pos[2] + Math.cos(cam.yaw) * cp
    );
    renderer.render(scene, camera);
  }

  return { renderer, scene, camera, rebuildChunk, rebuildAll, render, resize };
}

export function isMobile() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || 'ontouchstart' in window;
}
```

- [ ] **Step 2: Manual smoke check**

Wire a throwaway in `main.js`: create world, `fillFloor(8)`, `createWorldView`, `rebuildAll()`,
place camera at `[64, 20, 64]` looking down, render once. Run `npm run dev`, open
`http://localhost:8093`, confirm a green floor is visible. (This is replaced by the real loop in
Task 12; the check is just to catch obvious WebGL wiring errors.)

- [ ] **Step 3: Commit**

```bash
git add lib/render/world-view.js
git commit -m "feat(render): chunked world view with shared vertex-color material + dirty rebuild"
```

---

## Task 9: Persistence (current world via PlaySDK)

**Files:**
- Create: `lib/persist/world-store.js`, `test/world-store.test.js`

- [ ] **Step 1: Write failing test — `test/world-store.test.js`** (mock PlaySDK)

```js
import { describe, it, expect, vi } from 'vitest';
import { createWorld, setBlock, getBlock } from '../lib/voxel/store.js';
import { saveCurrent, loadCurrent, makeAutosaver } from '../lib/persist/world-store.js';

function mockSDK() {
  const kv = new Map();
  return {
    kv,
    save: vi.fn((k, v) => { kv.set(k, v); return Promise.resolve(); }),
    load: vi.fn((k) => Promise.resolve(kv.has(k) ? kv.get(k) : null)),
  };
}

describe('world-store', () => {
  it('saves and loads the current world through the SDK', async () => {
    const sdk = mockSDK();
    const w = createWorld(); setBlock(w, 3, 1, 4, 6);
    await saveCurrent(sdk, w);
    expect(sdk.save).toHaveBeenCalledWith('world:current', expect.any(String));
    const w2 = await loadCurrent(sdk);
    expect(getBlock(w2, 3, 1, 4)).toBe(6);
  });
  it('loadCurrent returns null when nothing is saved', async () => {
    const sdk = mockSDK();
    expect(await loadCurrent(sdk)).toBeNull();
  });
  it('autosaver debounces multiple calls into one save', async () => {
    vi.useFakeTimers();
    const sdk = mockSDK();
    const w = createWorld();
    const autosave = makeAutosaver(sdk, () => w, 1000);
    autosave(); autosave(); autosave();
    expect(sdk.save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(sdk.save).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test -- world-store` → Expected: FAIL.

- [ ] **Step 3: Implement `lib/persist/world-store.js`**

```js
import { serialize, deserialize } from '../voxel/rle.js';

const KEY = 'world:current';

export async function saveCurrent(sdk, world) {
  await sdk.save(KEY, serialize(world));
}

export async function loadCurrent(sdk) {
  const raw = await sdk.load(KEY);
  if (!raw) return null;
  return deserialize(raw);
}

// Returns a function you call after each edit; it coalesces a burst of edits into one save.
export function makeAutosaver(sdk, getWorld, delayMs = 3000) {
  let timer = null;
  return function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; saveCurrent(sdk, getWorld()); }, delayMs);
  };
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test -- world-store` → Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/persist/world-store.js test/world-store.test.js
git commit -m "feat(persist): current-world save/load via PlaySDK with debounced autosave"
```

---

## Task 10: Desktop input

**Files:**
- Create: `lib/input/desktop.js`

Browser module (pointer-lock, listeners) — manual verification. Produces a per-frame `intent` and
fires `onPlace`/`onBreak`/`onPick` callbacks.

- [ ] **Step 1: Implement `lib/input/desktop.js`**

```js
const KEY = { w:'forward+', s:'forward-', d:'strafe+', a:'strafe-', ' ':'vertical+', shift:'vertical-' };

export function createDesktopInput(canvas, { onPlace, onBreak, onPick, onMenu }) {
  const keys = new Set();
  let dYaw = 0, dPitch = 0;
  const LOOK = 0.0022;

  canvas.addEventListener('click', () => { if (document.pointerLockElement !== canvas) canvas.requestPointerLock(); });
  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== canvas) return;
    dYaw -= e.movementX * LOOK; dPitch -= e.movementY * LOOK;
  });
  document.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'escape') { onMenu && onMenu(); return; }
    if (k >= '1' && k <= '9') { onPick && onPick(parseInt(k, 10)); return; }
    keys.add(k === ' ' ? ' ' : k);
  });
  document.addEventListener('keyup', (e) => keys.delete(e.key === ' ' ? ' ' : e.key.toLowerCase()));
  canvas.addEventListener('mousedown', (e) => {
    if (document.pointerLockElement !== canvas) return;
    if (e.button === 0) onBreak && onBreak();
    if (e.button === 2) onPlace && onPlace();
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  function pollIntent() {
    const axis = (plus, minus) => (keys.has(plus) ? 1 : 0) - (keys.has(minus) ? 1 : 0);
    const intent = {
      forward: axis('w', 's'),
      strafe: axis('d', 'a'),
      vertical: axis(' ', 'shift'),
      dYaw, dPitch,
    };
    dYaw = 0; dPitch = 0; // consume look delta
    return intent;
  }
  return { pollIntent, active: () => document.pointerLockElement === canvas };
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/input/desktop.js
git commit -m "feat(input): desktop pointer-lock WASD fly + click place/break + number-key pick"
```

---

## Task 11: Mobile input + HUD

**Files:**
- Create: `lib/input/mobile.js`, `lib/ui/hud.js`
- Modify: `index.html` (HUD DOM)

- [ ] **Step 1: Add HUD DOM to `index.html`** (inside `<body>`, before the scripts)

```html
<div id="hud" style="position:absolute;inset:0;pointer-events:none;font-family:-apple-system,system-ui,sans-serif;color:#fff">
  <div id="topbar" style="position:absolute;top:env(safe-area-inset-top,8px);left:0;right:0;display:flex;justify-content:space-between;padding:8px 12px;font-weight:600;text-shadow:0 1px 2px rgba(0,0,0,.5)">
    <button id="menuBtn" style="pointer-events:auto;background:rgba(0,0,0,.35);border:0;color:#fff;border-radius:8px;padding:6px 10px;font-size:18px">☰</button>
    <span id="ver" style="opacity:.8;font-size:13px">v0.1.0</span>
  </div>
  <div id="crosshair" style="position:absolute;left:50%;top:50%;width:22px;height:22px;transform:translate(-50%,-50%)">
    <div style="position:absolute;left:10px;top:3px;width:2px;height:16px;background:#fff;opacity:.85"></div>
    <div style="position:absolute;top:10px;left:3px;height:2px;width:16px;background:#fff;opacity:.85"></div>
  </div>
  <div id="palette" style="position:absolute;left:0;right:0;bottom:env(safe-area-inset-bottom,10px);display:flex;gap:6px;overflow-x:auto;padding:8px 12px;pointer-events:auto"></div>
  <!-- mobile-only controls injected by hud.js when touch is present -->
  <div id="touchUI"></div>
</div>
```

- [ ] **Step 2: Implement `lib/ui/hud.js`**

```js
import { PALETTE_HEX } from '../palette.js';
import { isMobile } from '../render/world-view.js';

export function createHUD({ onPick, getSelected }) {
  const pal = document.getElementById('palette');
  PALETTE_HEX.forEach((hex, i) => {
    if (i === 0) return; // skip air
    const sw = document.createElement('button');
    sw.style.cssText = `flex:0 0 auto;width:34px;height:34px;border-radius:8px;border:3px solid transparent;background:${hex};cursor:pointer`;
    sw.dataset.idx = i;
    sw.addEventListener('click', () => onPick(i));
    pal.appendChild(sw);
  });
  function refresh() {
    [...pal.children].forEach((sw) =>
      sw.style.borderColor = (+sw.dataset.idx === getSelected()) ? '#fff' : 'transparent');
  }
  refresh();
  return { refresh, isMobile: isMobile() };
}
```

- [ ] **Step 3: Implement `lib/input/mobile.js`** (joystick + look drag + buttons)

```js
// Creates touch controls. Left half = move joystick; right half = look-drag.
// Buttons: up/down fly, break, place. Produces the same intent shape as desktop.
export function createMobileInput(root, { onPlace, onBreak }) {
  let move = { x: 0, y: 0 };        // joystick vector, -1..1 (x=strafe, y=forward)
  let look = { dx: 0, dy: 0 };      // pending look delta
  let vertical = 0;                 // -1,0,1 from fly buttons
  const LOOK = 0.005;

  root.innerHTML = `
    <div id="stick" style="position:absolute;left:24px;bottom:90px;width:120px;height:120px;border-radius:50%;background:rgba(255,255,255,.12);pointer-events:auto">
      <div id="knob" style="position:absolute;left:40px;top:40px;width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,.5)"></div>
    </div>
    <div style="position:absolute;right:16px;bottom:150px;display:flex;flex-direction:column;gap:8px;pointer-events:auto">
      <button id="flyUp" style="width:56px;height:48px;font-size:20px">▲</button>
      <button id="flyDn" style="width:56px;height:48px;font-size:20px">▼</button>
    </div>
    <div style="position:absolute;right:16px;bottom:32px;display:flex;gap:10px;pointer-events:auto">
      <button id="brk" style="width:80px;height:56px">Break</button>
      <button id="plc" style="width:80px;height:56px">Place</button>
    </div>`;

  // joystick
  const stick = root.querySelector('#stick'), knob = root.querySelector('#knob');
  let stickId = null, sc = { x: 0, y: 0 };
  stick.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0]; stickId = t.identifier;
    const r = stick.getBoundingClientRect(); sc = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    e.preventDefault();
  }, { passive: false });
  function stickMove(e) {
    for (const t of e.changedTouches) if (t.identifier === stickId) {
      let dx = (t.clientX - sc.x) / 60, dy = (t.clientY - sc.y) / 60;
      const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; }
      move = { x: dx, y: -dy };
      knob.style.left = 40 + dx * 40 + 'px'; knob.style.top = 40 - move.y * 40 + 'px';
    }
  }
  function stickEnd(e) {
    for (const t of e.changedTouches) if (t.identifier === stickId) {
      stickId = null; move = { x: 0, y: 0 }; knob.style.left = '40px'; knob.style.top = '40px';
    }
  }
  stick.addEventListener('touchmove', stickMove, { passive: false });
  stick.addEventListener('touchend', stickEnd);

  // look-drag on the right half of the screen
  let lookId = null, lp = { x: 0, y: 0 };
  root.parentElement.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    if (lookId === null && t.clientX > window.innerWidth / 2) { lookId = t.identifier; lp = { x: t.clientX, y: t.clientY }; }
  }, { passive: true });
  root.parentElement.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) if (t.identifier === lookId) {
      look.dx += -(t.clientX - lp.x) * LOOK; look.dy += -(t.clientY - lp.y) * LOOK;
      lp = { x: t.clientX, y: t.clientY };
    }
  }, { passive: true });
  root.parentElement.addEventListener('touchend', (e) => {
    for (const t of e.changedTouches) if (t.identifier === lookId) lookId = null;
  });

  const hold = (el, on, off) => {
    el.addEventListener('touchstart', (e) => { on(); e.preventDefault(); }, { passive: false });
    el.addEventListener('touchend', off);
  };
  hold(root.querySelector('#flyUp'), () => vertical = 1, () => vertical = 0);
  hold(root.querySelector('#flyDn'), () => vertical = -1, () => vertical = 0);
  root.querySelector('#brk').addEventListener('touchstart', (e) => { onBreak(); e.preventDefault(); }, { passive: false });
  root.querySelector('#plc').addEventListener('touchstart', (e) => { onPlace(); e.preventDefault(); }, { passive: false });

  function pollIntent() {
    const intent = { forward: move.y, strafe: move.x, vertical, dYaw: look.dx, dPitch: look.dy };
    look = { dx: 0, dy: 0 };
    return intent;
  }
  return { pollIntent };
}
```

- [ ] **Step 4: Manual check on a touch device / emulator**

Run `npm run dev`, open on a phone or Chrome device-emulation. Confirm joystick moves, drag looks,
fly buttons work, and place/break fire.

- [ ] **Step 5: Commit**

```bash
git add lib/input/mobile.js lib/ui/hud.js index.html
git commit -m "feat(input/ui): mobile joystick+look+buttons and HUD (crosshair, palette, version)"
```

---

## Task 12: Main wiring (the playable loop)

**Files:**
- Modify: `main.js` (replace placeholder)

- [ ] **Step 1: Implement `main.js`**

```js
import { createWorld, fillFloor, getBlock } from './lib/voxel/store.js';
import { createWorldView, isMobile } from './lib/render/world-view.js';
import { createFlyCamera, updateFlyCamera, lookDir } from './lib/player/fly-camera.js';
import { raycast } from './lib/voxel/raycast.js';
import { applyEdit } from './lib/voxel/edit.js';
import { createDesktopInput } from './lib/input/desktop.js';
import { createMobileInput } from './lib/input/mobile.js';
import { createHUD } from './lib/ui/hud.js';
import { loadCurrent, saveCurrent, makeAutosaver } from './lib/persist/world-store.js';
import { WX, WZ } from './lib/constants.js';

const REACH = 8;
let selected = 1;                       // current palette color
const canvas = document.getElementById('c');

async function boot() {
  const sdk = window.PlaySDK;
  // Load saved world or generate a flat grass floor.
  let world = null;
  if (sdk && sdk.load) { try { world = await loadCurrent(sdk); } catch {} }
  if (!world) { world = createWorld(); fillFloor(world, 8); }

  const view = createWorldView(canvas, world);
  view.rebuildAll();
  const cam = createFlyCamera([WX / 2, 18, WZ / 2], 0, -0.5);

  const autosave = sdk && sdk.save ? makeAutosaver(sdk, () => world, 3000) : () => {};

  function doEdit(place) {
    const dir = lookDir(cam);
    const hit = raycast(world, cam.pos, dir, REACH);
    if (!hit) return;
    let x = hit.cell[0], y = hit.cell[1], z = hit.cell[2], block = 0;
    if (place) { x += hit.normal[0]; y += hit.normal[1]; z += hit.normal[2]; block = selected; }
    const res = applyEdit(world, x, y, z, block);
    if (res.ok) { res.dirty.forEach((id) => view.rebuildChunk(id)); autosave(); }
  }

  const hud = createHUD({ onPick: (i) => { selected = i; hud.refresh(); }, getSelected: () => selected });

  const desktop = createDesktopInput(canvas, {
    onPlace: () => doEdit(true), onBreak: () => doEdit(false),
    onPick: (i) => { if (i <= 16) { selected = i; hud.refresh(); } },
    onMenu: () => { /* Plan 2: open menu */ },
  });
  const mobile = isMobile()
    ? createMobileInput(document.getElementById('touchUI'), { onPlace: () => doEdit(true), onBreak: () => doEdit(false) })
    : null;

  // PlaySDK pause/resume (battery)
  let running = true;
  if (sdk && sdk.onPause) sdk.onPause(() => { running = false; });
  if (sdk && sdk.onResume) sdk.onResume(() => { if (!running) { running = true; last = performance.now(); loop(last); } });
  window.addEventListener('beforeunload', () => { if (sdk && sdk.save) saveCurrent(sdk, world); });

  let last = performance.now();
  function loop(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const intent = mobile ? mobile.pollIntent() : desktop.pollIntent();
    updateFlyCamera(cam, intent, dt);
    view.render(cam);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // screenshot mode: just render the loaded scene (no menus to skip yet)
}

if (window.PlaySDK && window.PlaySDK.onReady) window.PlaySDK.onReady(boot); else boot();
```

- [ ] **Step 2: Manual playtest**

Run `npm run dev`, open `http://localhost:8093`:
- Desktop: click to lock pointer, fly with WASD/Space/Shift, look with mouse, left-click breaks, right-click places, number keys 1–9 change color, palette swatches highlight.
- Reload the page: your edits persist (loaded from `world:current`). (If signed out locally, PlaySDK
  load returns null and you start on a fresh floor — that's expected; persistence is verified by the
  unit test and on the live platform.)

- [ ] **Step 3: Commit**

```bash
git add main.js
git commit -m "feat: wire playable solo loop (fly, place/break, palette, persistence, pause/resume)"
```

---

## Task 13: Headless render smoke test + thumbnail

**Files:**
- Create: `scripts/smoke.mjs`

Per the project rule that thumbnails use a real 3D render, this both verifies the game renders
headlessly and captures the thumbnail from the actual game.

- [ ] **Step 1: Implement `scripts/smoke.mjs`**

```js
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const server = spawn('node', ['scripts/dev-server.mjs'], { stdio: 'inherit' });
await new Promise((r) => setTimeout(r, 800));

const browser = await puppeteer.launch({ args: ['--use-gl=swiftshader', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://localhost:8093', { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1500)); // let a few frames render

// Assert the canvas drew something non-uniform (i.e., the floor/blocks are visible, not just sky).
const varied = await page.evaluate(() => {
  const c = document.getElementById('c');
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  const px = new Uint8Array(4 * 64);
  // sample a horizontal strip near the bottom third where the floor should be
  gl.readPixels(0, Math.floor(c.height * 0.66), 64, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let min = 255, max = 0;
  for (let i = 0; i < px.length; i += 4) { min = Math.min(min, px[i + 1]); max = Math.max(max, px[i + 1]); }
  return { min, max };
});

await page.screenshot({ path: 'thumbnail-raw.png' });
await browser.close();
server.kill();

if (errors.length) { console.error('PAGE ERRORS:', errors); process.exit(1); }
console.log('render sample green min/max:', varied);
if (varied.max <= varied.min) { console.error('canvas looks uniform — render failed'); process.exit(1); }
console.log('SMOKE OK — screenshot saved to thumbnail-raw.png');
```

- [ ] **Step 2: Run the smoke test**

Run: `npm run smoke`
Expected: prints `SMOKE OK` and no page errors. If Puppeteer can't find a browser, run
`npx puppeteer browsers install chrome` first.

- [ ] **Step 3: Make the 512×512 thumbnail from the real render**

Frame a nice angle (fly the camera, build a small structure) and crop `thumbnail-raw.png` to a
512×512 `thumbnail.png` with the title overlaid. Manual/asset step — must be an actual game render
(not CSS/SVG), per project rules. Commit the final `thumbnail.png`.

- [ ] **Step 4: Commit**

```bash
git add scripts/smoke.mjs thumbnail.png
git commit -m "test: headless render smoke check + real-render thumbnail"
```

---

## Task 14: Full test pass, version bump, finalize

- [ ] **Step 1: Run the whole suite**

Run: `npm test`
Expected: all suites pass (store, rle, palette, mesher, raycast, edit, fly-camera, world-store).

- [ ] **Step 2: Bump version** (per the per-commit version-bump rule)

Set `index.html` `<meta name="game-version" content="v0.2.0">`, the `#ver` span text to `v0.2.0`,
and `package.json` `"version": "0.2.0"`.

- [ ] **Step 3: Commit**

```bash
git add index.html package.json
git commit -m "chore: Plan 1 complete — solo creative sandbox playable; bump v0.2.0"
```

- [ ] **Step 4: Hand-off note**

Plan 1 delivers a persistent solo builder. Do NOT deploy from this plan (per the deploy-gating rule —
the user verifies locally and deploys). Next: write Plan 2 (multiplayer: rooms, snapshot-on-join,
edit sync, avatars+names, per-person grants, My-Worlds/create/join menus), which layers on
`main.js`, adds `lib/net/session.js`, `lib/render/avatars.js`, and the menu UI.

---

## Self-Review (completed during authoring)

- **Spec coverage:** §6 voxel engine → Tasks 1,4,5,6,8; §7 persistence → Task 9 (single-world slice;
  multi-world index is Plan 2 per the stated decision); §8 controls/HUD → Tasks 10,11,12; §9 solo
  scope → Tasks 0–14. Multiplayer (§4,§5, avatars, grants, share/join) is explicitly Plan 2.
- **Placeholders:** none — every code step contains complete code; the only manual steps (thumbnail
  art, on-device touch check) are inherently human/asset steps, with exact preceding commands.
- **Type/name consistency:** `meshChunk(world,cx,cy,cz)→{positions,normals,colors,indices}` used
  identically in mesher test + world-view; `applyEdit`/`dirtyChunksFor` names match across edit
  module, test, and main; `createFlyCamera/updateFlyCamera/lookDir`, `saveCurrent/loadCurrent/
  makeAutosaver`, `createWorldView` API (`rebuildChunk/rebuildAll/render`) consistent across tasks.
- **Imports:** `lib/voxel/rle.js` imports only `VOXELS as N` from constants; no coupling to store.
