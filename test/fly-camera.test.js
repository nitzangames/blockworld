import { describe, it, expect } from 'vitest';
import { createFlyCamera, updateFlyCamera, lookDir } from '../lib/player/fly-camera.js';

describe('fly camera', () => {
  it('moving forward with yaw=0 increases +z (or -z) consistently with lookDir', () => {
    const cam = createFlyCamera([10, 10, 10], 0, 0);
    updateFlyCamera(cam, { forward: 1, strafe: 0, vertical: 0, dYaw: 0, dPitch: 0 }, 0.1);
    const d = lookDir(cam);
    expect(Math.sign(cam.pos[0] - 10)).toBe(Math.sign(d[0]) || 0);
    expect(Math.sign(cam.pos[2] - 10)).toBe(Math.sign(d[2]) || 0);
  });
  it('vertical intent changes y up', () => {
    const cam = createFlyCamera([0, 5, 0], 0, 0);
    updateFlyCamera(cam, { forward: 0, strafe: 0, vertical: 1, dYaw: 0, dPitch: 0 }, 0.1);
    expect(cam.pos[1]).toBeGreaterThan(5);
  });
  it('clamps pitch to just under +/- 90°', () => {
    const cam = createFlyCamera([0, 0, 0], 0, 0);
    for (let i = 0; i < 200; i++) updateFlyCamera(cam, { forward:0,strafe:0,vertical:0,dYaw:0,dPitch:1 }, 0.1);
    expect(cam.pitch).toBeLessThan(Math.PI / 2);
    expect(cam.pitch).toBeGreaterThan(Math.PI / 2 - 0.2);
  });
  // Hot path: called every frame — returns one shared, reused array (no per-call allocation).
  it('lookDir returns the same shared array each call', () => {
    const cam = createFlyCamera([0, 0, 0], 0, 0);
    expect(lookDir(cam)).toBe(lookDir(cam));
  });
});
