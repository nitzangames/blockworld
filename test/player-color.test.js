import { describe, it, expect } from 'vitest';
import { playerColor } from '../lib/player/player-color.js';

describe('player color', () => {
  it('returns a stable #rrggbb for a given id', () => {
    const a = playerColor('user-123');
    expect(a).toMatch(/^#[0-9a-f]{6}$/);
    expect(playerColor('user-123')).toBe(a);
  });
  it('different ids usually differ', () => {
    expect(playerColor('aaa')).not.toBe(playerColor('zzz'));
  });
});
