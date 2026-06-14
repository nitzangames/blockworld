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
