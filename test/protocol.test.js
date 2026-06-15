import { describe, it, expect } from 'vitest';
import { T, chunkSnapshot, SnapshotReassembler } from '../lib/net/protocol.js';

describe('protocol', () => {
  it('defines short distinct message-type tags', () => {
    const vals = Object.values(T);
    expect(new Set(vals).size).toBe(vals.length);
    expect(T.SNAPSHOT).toBeDefined();
    expect(T.EDIT).toBeDefined();
  });
  it('chunks a blob into pieces of seq/total/data and a tiny blob is one piece', () => {
    expect(chunkSnapshot('abcd', 100)).toEqual([{ seq: 0, total: 1, data: 'abcd' }]);
    const pieces = chunkSnapshot('abcdefg', 3);
    expect(pieces.map((p) => p.data)).toEqual(['abc', 'def', 'g']);
    expect(pieces.every((p) => p.total === 3)).toBe(true);
  });
  it('reassembles pieces (in any order) back into the original blob', () => {
    const pieces = chunkSnapshot('hello world snapshot', 4);
    const r = new SnapshotReassembler();
    let done = null;
    for (const p of [...pieces].reverse()) done = r.add(p) || done;
    expect(done).toBe('hello world snapshot');
  });
  it('reassembler returns null until all pieces are in', () => {
    const r = new SnapshotReassembler();
    expect(r.add({ seq: 0, total: 2, data: 'aa' })).toBeNull();
    expect(r.add({ seq: 1, total: 2, data: 'bb' })).toBe('aabb');
  });
});
