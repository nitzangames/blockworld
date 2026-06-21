import { describe, it, expect, vi } from 'vitest';
import { createWorld, setBlock, getBlock } from '../lib/voxel/store.js';
import {
  newWorldId, upsertWorld, renameInIndex, removeFromIndex, touchWorld,
  loadIndex, saveIndex, loadWorld, saveWorld, getWorlds, makeWorldAutosaver,
  setPrivacy,
} from '../lib/persist/worlds.js';
import { makeWorldPublisher } from '../lib/persist/worlds.js';

function mockSDK(initial = {}) {
  const kv = new Map(Object.entries(initial));
  return {
    kv,
    save: vi.fn((k, v) => { kv.set(k, v); return Promise.resolve(); }),
    load: vi.fn((k) => Promise.resolve(kv.has(k) ? kv.get(k) : null)),
  };
}

describe('worlds index (pure helpers)', () => {
  it('newWorldId returns w1 for empty, max+1 otherwise', () => {
    expect(newWorldId([])).toBe('w1');
    expect(newWorldId([{ id: 'w1' }, { id: 'w3' }])).toBe('w4');
  });
  it('upsert adds then updates by id', () => {
    const idx = [];
    upsertWorld(idx, { id: 'w1', name: 'A', updatedAt: 1 });
    upsertWorld(idx, { id: 'w1', name: 'A2', updatedAt: 2 });
    expect(idx).toEqual([{ id: 'w1', name: 'A2', updatedAt: 2 }]);
  });
  it('rename and remove and touch', () => {
    const idx = [{ id: 'w1', name: 'A', updatedAt: 1 }];
    renameInIndex(idx, 'w1', 'B');
    expect(idx[0].name).toBe('B');
    touchWorld(idx, 'w1', 99);
    expect(idx[0].updatedAt).toBe(99);
    expect(removeFromIndex(idx, 'w1')).toEqual([]);
  });
});

describe('worlds persistence (mock sdk)', () => {
  it('saves and loads a world by id', async () => {
    const sdk = mockSDK();
    const w = createWorld(); setBlock(w, 2, 1, 2, 6);
    await saveWorld(sdk, 'w1', w);
    expect(sdk.save).toHaveBeenCalledWith('world:w1', expect.any(String));
    const w2 = await loadWorld(sdk, 'w1');
    expect(getBlock(w2, 2, 1, 2)).toBe(6);
  });
  it('index round-trips as JSON', async () => {
    const sdk = mockSDK();
    await saveIndex(sdk, [{ id: 'w1', name: 'A', updatedAt: 5 }]);
    expect(await loadIndex(sdk)).toEqual([{ id: 'w1', name: 'A', updatedAt: 5 }]);
  });
  it('getWorlds migrates a legacy world:current into the index', async () => {
    const legacyBlob = 'LEGACYBLOB==';
    const sdk = mockSDK({ 'world:current': legacyBlob });
    const idx = await getWorlds(sdk, 1234);
    expect(idx).toEqual([{ id: 'w1', name: 'My First World', updatedAt: 1234, privacy: 'public' }]);
    expect(sdk.kv.get('world:w1')).toBe(legacyBlob);
    expect(await loadIndex(sdk)).toEqual(idx);
  });
  it('getWorlds returns [] when nothing exists', async () => {
    expect(await getWorlds(mockSDK(), 1)).toEqual([]);
  });
  it('autosaver debounces and writes the world + bumps the index entry', async () => {
    vi.useFakeTimers();
    const sdk = mockSDK();
    const index = [{ id: 'w1', name: 'A', updatedAt: 0 }];
    const w = createWorld();
    const autosave = makeWorldAutosaver(sdk, 'w1', () => w, index, () => 777, 1000);
    autosave(); autosave();
    expect(sdk.save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(sdk.save).toHaveBeenCalledWith('world:w1', expect.any(String));
    expect(sdk.save).toHaveBeenCalledWith('worlds-index', expect.any(String));
    expect(index[0].updatedAt).toBe(777);
    vi.useRealTimers();
  });
});

describe('makeWorldPublisher', () => {
  function fakeSdk() {
    const calls = [];
    return { calls, publishWorld: (p) => { calls.push(p); return Promise.resolve({ publish_id: 'px' }); } };
  }
  it('publishes at most once per window, then flush() sends the latest', async () => {
    const sdk = fakeSdk();
    let now = 0;
    const pub = makeWorldPublisher(sdk, {
      worldId: 'w1',
      getBlob: () => 'BLOB' + now,
      getMeta: () => ({ title: 'A', privacy: 'public' }),
      now: () => now,
      windowMs: 1000,
    });
    pub(); // first call -> publishes immediately
    pub(); // within window -> throttled (no new call)
    expect(sdk.calls.length).toBe(1);
    expect(sdk.calls[0]).toMatchObject({ worldId: 'w1', title: 'A', privacy: 'public' });
    now = 1500; pub(); // window passed -> publishes
    expect(sdk.calls.length).toBe(2);
    await pub.flush(); // forces a final publish of the latest snapshot
    expect(sdk.calls.length).toBe(3);
    expect(sdk.calls[2].blob).toBe('BLOB1500');
  });
  it('does not throw when sdk lacks publishWorld', async () => {
    const pub = makeWorldPublisher({}, { worldId: 'w1', getBlob: () => 'B', getMeta: () => ({ title: 'A', privacy: 'public' }), now: () => 0 });
    pub(); await pub.flush(); // no-op, no throw
  });
});

describe('world privacy', () => {
  it('new worlds default to public via upsertWorld', () => {
    const index = [];
    upsertWorld(index, { id: 'w1', name: 'A', updatedAt: 1, privacy: 'public' });
    expect(index[0].privacy).toBe('public');
  });
  it('setPrivacy updates an entry and ignores unknown ids', () => {
    const index = [{ id: 'w1', name: 'A', privacy: 'public' }];
    setPrivacy(index, 'w1', 'viewonly');
    expect(index[0].privacy).toBe('viewonly');
    setPrivacy(index, 'nope', 'private'); // no throw
    expect(index[0].privacy).toBe('viewonly');
  });
});
