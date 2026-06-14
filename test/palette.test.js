import { describe, it, expect } from 'vitest';
import { PALETTE_HEX, PALETTE_RGB } from '../lib/palette.js';

describe('palette', () => {
  it('has 16 colors plus an air slot at index 0', () => {
    expect(PALETTE_HEX.length).toBe(17);
    expect(PALETTE_RGB.length).toBe(17);
  });
  it('normalizes rgb to 0..1', () => {
    const [r, g, b] = PALETTE_RGB[1];
    expect(r).toBeCloseTo(0xE9 / 255, 5);
    expect(g).toBeCloseTo(0xEC / 255, 5);
    expect(b).toBeCloseTo(0xEC / 255, 5);
  });
});
