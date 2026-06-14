import { describe, it, expect } from 'vitest';
import { createWorld, getBlock, setBlock, fillFloor } from '../lib/voxel/store.js';
import { WX, WZ, WY, VOXELS } from '../lib/constants.js';

describe('voxel store', () => {
  it('creates an all-air world of the right size', () => {
    const w = createWorld();
    expect(w.length).toBe(VOXELS);
    expect(getBlock(w, 5, 5, 5)).toBe(0);
  });
  it('sets and gets a block', () => {
    const w = createWorld();
    setBlock(w, 10, 2, 3, 7);
    expect(getBlock(w, 10, 2, 3)).toBe(7);
  });
  it('treats out-of-bounds reads as air and ignores oob writes', () => {
    const w = createWorld();
    expect(getBlock(w, -1, 0, 0)).toBe(0);
    expect(getBlock(w, WX, 0, 0)).toBe(0);
    expect(setBlock(w, -1, 0, 0, 5)).toBe(false);
    expect(setBlock(w, 0, WY, 0, 5)).toBe(false);
  });
  it('fillFloor lays one solid layer at y=0', () => {
    const w = createWorld();
    fillFloor(w, 8);
    expect(getBlock(w, 0, 0, 0)).toBe(8);
    expect(getBlock(w, WX - 1, 0, WZ - 1)).toBe(8);
    expect(getBlock(w, 0, 1, 0)).toBe(0);
  });
});
