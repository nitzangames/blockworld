import { getBlock } from './store.js';

function distToBound(o, s) { return s > 0 ? (Math.floor(o) + 1 - o) : (o - Math.floor(o)); }

// Reused result, returned on a hit, so the per-frame raycast in the render loop allocates
// nothing. The caller reads it synchronously before the next call.
const _hit = { cell: [0, 0, 0], normal: [0, 0, 0] };
function hit(x, y, z, nx, ny, nz) {
  _hit.cell[0] = x; _hit.cell[1] = y; _hit.cell[2] = z;
  _hit.normal[0] = nx; _hit.normal[1] = ny; _hit.normal[2] = nz;
  return _hit;
}

// origin: world-space [x,y,z] (block units). dir: normalized [x,y,z]. maxDist in blocks.
// Returns the shared { cell:[x,y,z], normal:[x,y,z] } of the first solid voxel, or null.
export function raycast(w, origin, dir, maxDist) {
  let x = Math.floor(origin[0]), y = Math.floor(origin[1]), z = Math.floor(origin[2]);
  const stepX = Math.sign(dir[0]), stepY = Math.sign(dir[1]), stepZ = Math.sign(dir[2]);
  const tDeltaX = dir[0] !== 0 ? Math.abs(1 / dir[0]) : Infinity;
  const tDeltaY = dir[1] !== 0 ? Math.abs(1 / dir[1]) : Infinity;
  const tDeltaZ = dir[2] !== 0 ? Math.abs(1 / dir[2]) : Infinity;
  let tMaxX = dir[0] !== 0 ? distToBound(origin[0], stepX) * tDeltaX : Infinity;
  let tMaxY = dir[1] !== 0 ? distToBound(origin[1], stepY) * tDeltaY : Infinity;
  let tMaxZ = dir[2] !== 0 ? distToBound(origin[2], stepZ) * tDeltaZ : Infinity;
  let t = 0;
  if (getBlock(w, x, y, z)) return hit(x, y, z, 0, 0, 0);
  while (t <= maxDist) {
    let nx = 0, ny = 0, nz = 0;
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX; t = tMaxX; tMaxX += tDeltaX; nx = -stepX;
    } else if (tMaxY < tMaxZ) {
      y += stepY; t = tMaxY; tMaxY += tDeltaY; ny = -stepY;
    } else {
      z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nz = -stepZ;
    }
    if (t > maxDist) break;
    if (getBlock(w, x, y, z)) return hit(x, y, z, nx, ny, nz);
  }
  return null;
}
