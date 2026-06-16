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

  it('look input updates yaw and pitch (clamped)', () => {
    const w = createWorld();
    const cam = cameraAt(10, 20, 10);
    updateWalkCamera(cam, { forward: 0, strafe: 0, vertical: 0, dYaw: 0.5, dPitch: -0.3 }, 0.016, w);
    expect(cam.yaw).toBeCloseTo(0.5, 6);
    expect(cam.pitch).toBeCloseTo(-0.3, 6);
    // pitch clamps to just under -90 degrees
    for (let i = 0; i < 50; i++) updateWalkCamera(cam, { forward: 0, strafe: 0, vertical: 0, dYaw: 0, dPitch: -1 }, 0.016, w);
    expect(cam.pitch).toBeGreaterThan(-Math.PI / 2);
  });

  it('jumps only when grounded', () => {
    const w = createWorld(); fillFloor(w, 8);
    const cam = cameraAt(10, 2.6, 10); cam.grounded = true;
    const JUMP = { forward: 0, strafe: 0, vertical: 1, dYaw: 0, dPitch: 0 };
    updateWalkCamera(cam, JUMP, 0.016, w);
    expect(cam.pos[1]).toBeGreaterThan(2.6); // launched upward
    const risingVel = cam.vel[1];
    expect(risingVel).toBeGreaterThan(8); // ~JUMP_VEL, still rising
    // Airborne now (cam.grounded is false); holding jump must NOT re-launch.
    updateWalkCamera(cam, JUMP, 0.016, w);
    expect(cam.vel[1]).toBeLessThan(risingVel); // only gravity acted, no reset to JUMP_VEL
  });

  it('auto-climbs a 1-high step while walking into it', () => {
    const w = createWorld(); fillFloor(w, 8);
    for (let z = 9; z <= 11; z++) setBlock(w, 12, 1, z, 5); // 1-high step at x=12
    const cam = cameraAt(10.5, 2.6, 10.5, Math.PI / 2); cam.grounded = true; // yaw=PI/2 -> forward is +x
    const FWD = { forward: 1, strafe: 0, vertical: 0, dYaw: 0, dPitch: 0 };
    for (let i = 0; i < 120; i++) updateWalkCamera(cam, FWD, 0.016, w);
    expect(cam.pos[1]).toBeGreaterThan(3.4); // climbed: feet now on the block top (y=2), eye ~3.6
    expect(cam.pos[0]).toBeGreaterThan(12);  // walked up and onto the block
  });

  it('a 2-high wall blocks movement (no climb)', () => {
    const w = createWorld(); fillFloor(w, 8);
    for (let y = 1; y <= 2; y++) for (let z = 9; z <= 11; z++) setBlock(w, 12, y, z, 5); // 2-high wall
    const cam = cameraAt(10.5, 2.6, 10.5, Math.PI / 2); cam.grounded = true;
    const FWD = { forward: 1, strafe: 0, vertical: 0, dYaw: 0, dPitch: 0 };
    for (let i = 0; i < 120; i++) updateWalkCamera(cam, FWD, 0.016, w);
    expect(cam.pos[0]).toBeLessThan(11.8); // stopped at the wall
    expect(cam.pos[1]).toBeLessThan(3.0);  // did NOT climb (still ~2.6)
  });
});
