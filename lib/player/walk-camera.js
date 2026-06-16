import { getBlock } from '../voxel/store.js';

// Player body (the camera `pos` is the eye).
const RADIUS = 0.3;   // half-width of the 0.6 x 0.6 footprint
const HEIGHT = 1.8;
const EYE = 1.6;      // eye height above the feet
// Tunables.
const WALK_SPEED = 5.5; // blocks/s
const GRAVITY = 30;     // blocks/s^2
const JUMP_VEL = 8.7;   // blocks/s  -> peak ~1.26 blocks
const STEP = 1.0;       // max auto-climb height
const EPS = 1e-4;
const PITCH_LIMIT = Math.PI / 2 - 0.01;

// True if the AABB derived from eye position (px,py,pz) overlaps any solid voxel.
// Scalars only — no allocation (runs several times per frame).
function collides(world, px, py, pz) {
  const x0 = Math.floor(px - RADIUS), x1 = Math.floor(px + RADIUS - EPS);
  const y0 = Math.floor(py - EYE), y1 = Math.floor(py - EYE + HEIGHT - EPS);
  const z0 = Math.floor(pz - RADIUS), z1 = Math.floor(pz + RADIUS - EPS);
  for (let y = y0; y <= y1; y++)
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++)
        if (getBlock(world, x, y, z)) return true;
  return false;
}

// True when there is a solid block directly beneath the player's feet at (px,py,pz).
// Used for ledge-cling: grounded players won't walk off elevated platforms.
function hasSupportAt(world, px, py, pz) {
  const sy = Math.floor(py - EYE - EPS); // voxel y of the block under the foot
  const x0 = Math.floor(px - RADIUS), x1 = Math.floor(px + RADIUS - EPS);
  const z0 = Math.floor(pz - RADIUS), z1 = Math.floor(pz + RADIUS - EPS);
  for (let z = z0; z <= z1; z++)
    for (let x = x0; x <= x1; x++)
      if (getBlock(world, x, sy, z)) return true;
  return false;
}

// Mutates cam in place; cam = { pos:[x,y,z] (eye), yaw, pitch, vel:[vx,vy,vz], grounded }.
export function updateWalkCamera(cam, intent, dt, world) {
  const p = cam.pos, v = cam.vel;

  // Look (same as the fly camera) — update yaw/pitch before using yaw for movement direction.
  cam.yaw += intent.dYaw;
  cam.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, cam.pitch + intent.dPitch));

  // 1. Horizontal target velocity from yaw-relative input (look up/down freely, walk flat).
  const sinY = Math.sin(cam.yaw), cosY = Math.cos(cam.yaw);
  const tvx = (sinY * intent.forward - cosY * intent.strafe) * WALK_SPEED;
  const tvz = (cosY * intent.forward + sinY * intent.strafe) * WALK_SPEED;
  const k = 1 - Math.exp(-16 * dt);
  v[0] += (tvx - v[0]) * k;
  v[2] += (tvz - v[2]) * k;

  // 2. Gravity.
  v[1] -= GRAVITY * dt;

  // 3. Jump uses the prior frame's grounded state.
  if (intent.vertical > 0 && cam.grounded) v[1] = JUMP_VEL;

  // 4. Move + collide, axis by axis.
  let grounded = false;

  // Y first.
  p[1] += v[1] * dt;
  if (collides(world, p[0], p[1], p[2])) {
    if (v[1] < 0) { p[1] = Math.floor(p[1] - EYE) + 1 + EYE; grounded = true; } // land: snap to surface
    else { p[1] -= v[1] * dt; } // ceiling: revert
    v[1] = 0;
  }

  let stepUsed = false; // at most one auto-step per frame (prevents diagonal double-lift)

  // X with auto-step and ledge-cling.
  p[0] += v[0] * dt;
  if (collides(world, p[0], p[1], p[2])) {
    let stepped = false;
    if (grounded && !stepUsed) {
      p[1] += STEP;
      if (!collides(world, p[0], p[1], p[2])) { stepped = true; stepUsed = true; } else p[1] -= STEP;
    }
    if (!stepped) { p[0] -= v[0] * dt; v[0] = 0; }
  } else if (grounded && !hasSupportAt(world, p[0], p[1], p[2])) {
    // Ledge-cling: don't walk off the edge of elevated terrain while grounded.
    p[0] -= v[0] * dt; v[0] = 0;
  }

  // Z with auto-step and ledge-cling.
  p[2] += v[2] * dt;
  if (collides(world, p[0], p[1], p[2])) {
    let stepped = false;
    if (grounded && !stepUsed) {
      p[1] += STEP;
      if (!collides(world, p[0], p[1], p[2])) { stepped = true; stepUsed = true; } else p[1] -= STEP;
    }
    if (!stepped) { p[2] -= v[2] * dt; v[2] = 0; }
  } else if (grounded && !hasSupportAt(world, p[0], p[1], p[2])) {
    // Ledge-cling: don't walk off the edge of elevated terrain while grounded.
    p[2] -= v[2] * dt; v[2] = 0;
  }

  cam.grounded = grounded;
  return cam;
}
