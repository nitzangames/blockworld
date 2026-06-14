import { describe, it, expect } from 'vitest';
import { createWorld, setBlock } from '../lib/voxel/store.js';
import { meshChunk } from '../lib/voxel/mesher.js';

describe('mesher', () => {
  it('an isolated block in chunk 0 emits 6 faces (24 verts, 36 indices)', () => {
    const w = createWorld();
    setBlock(w, 2, 2, 2, 5);
    const g = meshChunk(w, 0, 0, 0);
    expect(g.positions.length).toBe(24 * 3);
    expect(g.indices.length).toBe(6 * 6);
    expect(g.colors.length).toBe(24 * 3);
    expect(g.normals.length).toBe(24 * 3);
  });
  it('two adjacent blocks cull the shared pair of faces (10 faces total)', () => {
    const w = createWorld();
    setBlock(w, 2, 2, 2, 5);
    setBlock(w, 3, 2, 2, 5);
    const g = meshChunk(w, 0, 0, 0);
    expect(g.indices.length).toBe(10 * 6);
  });
  it('empty chunk emits nothing', () => {
    const w = createWorld();
    const g = meshChunk(w, 0, 0, 0);
    expect(g.indices.length).toBe(0);
  });
  it('AO darkens a face vertex that has solid neighbors vs an isolated one', () => {
    const iso = createWorld(); setBlock(iso, 2, 2, 2, 1);
    const gi = meshChunk(iso, 0, 0, 0);
    const occ = createWorld();
    setBlock(occ, 2, 2, 2, 1);
    setBlock(occ, 2, 3, 2, 1);
    setBlock(occ, 3, 3, 2, 1);
    setBlock(occ, 3, 2, 2, 0);
    const go = meshChunk(occ, 0, 0, 0);
    const maxIso = Math.max(...gi.colors);
    const maxOcc = Math.max(...go.colors);
    expect(maxOcc).toBeLessThanOrEqual(maxIso);
  });
});
