const SPEED = 14;          // blocks/sec
const PITCH_LIMIT = Math.PI / 2 - 0.01;

export function createFlyCamera(pos, yaw, pitch) {
  // grounded is only used by the walk camera, but initialize it so the camera shape is complete.
  return { pos: [...pos], yaw, pitch, vel: [0, 0, 0], grounded: false };
}

// Reused across frames to avoid per-frame allocation (GC pressure). The caller consumes the
// result synchronously before the next call, so a shared scratch array is safe.
const _dir = [0, 0, 0];
export function lookDir(cam) {
  const cp = Math.cos(cam.pitch);
  _dir[0] = Math.sin(cam.yaw) * cp;
  _dir[1] = Math.sin(cam.pitch);
  _dir[2] = Math.cos(cam.yaw) * cp;
  return _dir;
}

// intent: { forward, strafe, vertical in [-1,1]; dYaw, dPitch in radians }
// Allocation-free: all intermediates are scalars (runs every frame).
export function updateFlyCamera(cam, intent, dt) {
  cam.yaw += intent.dYaw;
  cam.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, cam.pitch + intent.dPitch));
  const sinY = Math.sin(cam.yaw), cosY = Math.cos(cam.yaw);
  // forward = (sinY, 0, cosY); right-hand strafe axis = (-cosY, 0, sinY)
  const tvx = (sinY * intent.forward - cosY * intent.strafe) * SPEED;
  const tvy = intent.vertical * SPEED;
  const tvz = (cosY * intent.forward + sinY * intent.strafe) * SPEED;
  const k = 1 - Math.exp(-12 * dt);
  cam.vel[0] += (tvx - cam.vel[0]) * k; cam.pos[0] += cam.vel[0] * dt;
  cam.vel[1] += (tvy - cam.vel[1]) * k; cam.pos[1] += cam.vel[1] * dt;
  cam.vel[2] += (tvz - cam.vel[2]) * k; cam.pos[2] += cam.vel[2] * dt;
  return cam;
}
