import { describe, it, expect } from 'vitest';
import { createWorld, getBlock, setBlock } from '../lib/voxel/store.js';
import { applyEdit, dirtyChunksFor } from '../lib/voxel/edit.js';

describe('edit', () => {
  it('break clears the cell and returns its chunk id', () => {
    const w = createWorld();
    setBlock(w, 2, 2, 2, 5);
    const res = applyEdit(w, 2, 2, 2, 0);
    expect(res.ok).toBe(true);
    expect(getBlock(w, 2, 2, 2)).toBe(0);
    expect(res.dirty).toContain(0);
  });
  it('place sets the cell', () => {
    const w = createWorld();
    const res = applyEdit(w, 4, 4, 4, 7);
    expect(res.ok).toBe(true);
    expect(getBlock(w, 4, 4, 4)).toBe(7);
  });
  it('editing a boundary block marks the neighbor chunk too', () => {
    const w = createWorld();
    const ids = dirtyChunksFor(15, 0, 0);
    expect(ids).toContain(0);
    expect(ids).toContain(1);
  });
  it('rejects out-of-bounds edits', () => {
    const w = createWorld();
    expect(applyEdit(w, -1, 0, 0, 5).ok).toBe(false);
  });
});
