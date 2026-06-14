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
