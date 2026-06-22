import { serialize, deserialize } from '../voxel/rle.js';

const INDEX_KEY = 'worlds-index';
const LEGACY_KEY = 'world:current';

// --- pure index helpers ---
export function newWorldId(index) {
  let max = 0;
  for (const w of index) {
    const n = parseInt(String(w.id).replace(/^w/, ''), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return 'w' + (max + 1);
}
export function upsertWorld(index, entry) {
  const i = index.findIndex((w) => w.id === entry.id);
  if (i >= 0) index[i] = { ...index[i], ...entry }; else index.push(entry);
  return index;
}
export function renameInIndex(index, id, name) {
  const w = index.find((x) => x.id === id); if (w) w.name = name; return index;
}
export function removeFromIndex(index, id) {
  return index.filter((w) => w.id !== id);
}
export function setPrivacy(index, id, privacy) {
  const w = index.find((x) => x.id === id); if (w) w.privacy = privacy; return index;
}
export function touchWorld(index, id, now) {
  const w = index.find((x) => x.id === id); if (w) w.updatedAt = now; return index;
}

// --- sdk-backed ---
export async function loadIndex(sdk) {
  const raw = await sdk.load(INDEX_KEY);
  if (!raw) return [];
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch { return []; }
}
export async function saveIndex(sdk, index) { await sdk.save(INDEX_KEY, JSON.stringify(index)); }

export async function loadWorld(sdk, id) {
  const raw = await sdk.load('world:' + id);
  return raw ? deserialize(raw) : null;
}
export async function saveWorld(sdk, id, world) { await sdk.save('world:' + id, serialize(world)); }

// PlaySDK KV has no delete; drop from the index (so it's unlisted) and blank the blob.
export async function deleteWorld(sdk, index, id) {
  const next = removeFromIndex(index, id);
  await saveIndex(sdk, next);
  await sdk.save('world:' + id, '');
  return next;
}

// Listing entrypoint with one-time migration of the legacy single world.
export async function getWorlds(sdk, now) {
  let index = await loadIndex(sdk);
  if (index.length === 0) {
    const legacy = await sdk.load(LEGACY_KEY);
    if (legacy) {
      await sdk.save('world:w1', legacy);
      index = [{ id: 'w1', name: 'My First World', updatedAt: now || 0 }];
      await saveIndex(sdk, index);
    }
  }
  let migrated = false;
  for (const w of index) if (!w.privacy) { w.privacy = 'public'; migrated = true; } // migrate older entries
  if (migrated) await saveIndex(sdk, index);
  return index;
}

// Fork a published snapshot (base64 blob) into a brand-new owned world entry. Returns {id, world}.
// Caller persists it (saveWorld + saveIndex) and opens it.
export function forkWorld(index, blob, name) {
  const id = newWorldId(index);
  const world = deserialize(blob);
  upsertWorld(index, { id, name, updatedAt: Date.now(), privacy: 'public' });
  return { id, world };
}

// Throttled publisher: pushes the current world snapshot to the public gallery at most once per
// `windowMs`, plus a final flush() (call on leave). Best-effort — rejections are swallowed.
// opts: { worldId, getBlob(): string, getMeta(): {title, privacy}, now?: ()=>ms, windowMs?: ms }
export function makeWorldPublisher(sdk, opts) {
  const now = opts.now || (() => Date.now());
  const windowMs = opts.windowMs != null ? opts.windowMs : 20000;
  let last = -Infinity;
  function send() {
    if (!sdk || !sdk.publishWorld) return Promise.resolve();
    last = now();
    const meta = opts.getMeta();
    return sdk.publishWorld({ worldId: opts.worldId, title: meta.title, blob: opts.getBlob(), privacy: meta.privacy })
      .catch((e) => { try { console.warn('[blockworld] publish failed:', (e && e.message) || e); } catch (_) {} });
  }
  function schedule() {
    if (now() - last >= windowMs) send();
  }
  schedule.flush = () => send();
  return schedule;
}

// Debounced autosave for one world id: writes the blob and bumps its index entry.
// `nowFn` is injected so tests can pin the timestamp.
export function makeWorldAutosaver(sdk, id, getWorld, index, nowFn = () => Date.now(), delayMs = 3000) {
  let timer = null;
  return function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      timer = null;
      await saveWorld(sdk, id, getWorld());
      touchWorld(index, id, nowFn());
      await saveIndex(sdk, index);
    }, delayMs);
  };
}
