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
