import { describe, it, expect } from 'vitest';
import { createWorld, fillFloor, setBlock } from '../lib/voxel/store.js';
import { updateWalkCamera } from '../lib/player/walk-camera.js';

const STILL = { forward: 0, strafe: 0, vertical: 0, dYaw: 0, dPitch: 0 };
function cameraAt(x, y, z, yaw = 0) { return { pos: [x, y, z], yaw, pitch: 0, vel: [0, 0, 0], grounded: false }; }

describe('walk-camera', () => {
  it('falls under gravity in open air', () => {
    const w = createWorld(); // no floor
    const cam = cameraAt(10, 20, 10);
    updateWalkCamera(cam, STILL, 0.05, w);
    expect(cam.pos[1]).toBeLessThan(20);
    expect(cam.grounded).toBe(false);
  });

  it('lands on the floor and stays grounded (eye = floor top + eye height)', () => {
    const w = createWorld(); fillFloor(w, 8); // solid floor at y=0, top surface at y=1
    const cam = cameraAt(10, 5, 10);
    for (let i = 0; i < 200; i++) updateWalkCamera(cam, STILL, 0.016, w);
    expect(cam.pos[1]).toBeCloseTo(2.6, 5); // feet snap to y=1, eye = 1 + 1.6
    expect(cam.grounded).toBe(true);
  });
});
