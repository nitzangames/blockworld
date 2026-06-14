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
