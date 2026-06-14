import { describe, it, expect } from 'vitest';
import { createWorld, setBlock } from '../lib/voxel/store.js';
import { raycast } from '../lib/voxel/raycast.js';

describe('raycast', () => {
  it('hits the first solid block along +x and reports the -x face', () => {
    const w = createWorld();
    setBlock(w, 5, 0, 0, 3);
    const hit = raycast(w, [0.5, 0.5, 0.5], [1, 0, 0], 16);
    expect(hit).not.toBeNull();
    expect(hit.cell).toEqual([5, 0, 0]);
    expect(hit.normal).toEqual([-1, 0, 0]);
  });
  it('returns null when nothing is within range', () => {
    const w = createWorld();
    setBlock(w, 50, 0, 0, 3);
    expect(raycast(w, [0.5, 0.5, 0.5], [1, 0, 0], 8)).toBeNull();
  });
  it('hits a block from above reporting the +y face', () => {
    const w = createWorld();
    setBlock(w, 2, 0, 2, 8);
    const hit = raycast(w, [2.5, 5, 2.5], [0, -1, 0], 16);
    expect(hit.cell).toEqual([2, 0, 2]);
    expect(hit.normal).toEqual([0, 1, 0]);
  });
});
