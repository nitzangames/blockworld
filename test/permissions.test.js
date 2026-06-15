import { describe, it, expect } from 'vitest';
import { createPermissions } from '../lib/net/permissions.js';

describe('permissions', () => {
  it('owner can always edit, even if never added', () => {
    const p = createPermissions('owner');
    expect(p.canEdit('owner')).toBe(true);
  });
  it('a visitor defaults to no edit until granted', () => {
    const p = createPermissions('owner');
    p.add('vis', 'Vee');
    expect(p.canEdit('vis')).toBe(false);
    p.set('vis', true);
    expect(p.canEdit('vis')).toBe(true);
    p.set('vis', false);
    expect(p.canEdit('vis')).toBe(false);
  });
  it('lists current players with name + canEdit, and forgets removed ones', () => {
    const p = createPermissions('owner');
    p.add('a', 'A'); p.add('b', 'B'); p.set('b', true);
    expect(p.list()).toEqual([
      { userId: 'a', name: 'A', canEdit: false },
      { userId: 'b', name: 'B', canEdit: true },
    ]);
    p.remove('a');
    expect(p.list().map((x) => x.userId)).toEqual(['b']);
  });
});
