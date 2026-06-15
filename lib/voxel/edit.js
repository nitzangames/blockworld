import { setBlock } from './store.js';
import { CHUNK, NCX, NCY, NCZ, inBounds, chunkId } from '../constants.js';

// Return the set of chunk ids whose mesh must rebuild after changing (x,y,z):
// the owning chunk, plus any neighbor chunk if the block sits on a chunk-boundary face.
export function dirtyChunksFor(x, y, z) {
  const ids = new Set();
  const add = (cx, cy, cz) => {
    if (cx < 0 || cy < 0 || cz < 0 || cx >= NCX || cy >= NCY || cz >= NCZ) return;
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
