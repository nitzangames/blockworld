import { describe, it, expect } from 'vitest';
import { createWorld, setBlock, getBlock, fillFloor } from '../lib/voxel/store.js';
import { serialize, deserialize } from '../lib/voxel/rle.js';
import { VOXELS } from '../lib/constants.js';

describe('rle', () => {
  it('round-trips an all-air world to a tiny string', () => {
    const w = createWorld();
    const s = serialize(w);
    expect(typeof s).toBe('string');
    expect(s.length).toBeLessThan(50);
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
