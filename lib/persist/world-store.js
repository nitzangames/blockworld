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
