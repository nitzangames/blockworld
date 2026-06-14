const SPEED = 14;          // blocks/sec
const PITCH_LIMIT = Math.PI / 2 - 0.01;

export function createFlyCamera(pos, yaw, pitch) {
  return { pos: [...pos], yaw, pitch, vel: [0, 0, 0] };
}

export function lookDir(cam) {
  const cp = Math.cos(cam.pitch);
  return [Math.sin(cam.yaw) * cp, Math.sin(cam.pitch), Math.cos(cam.yaw) * cp];
}

// intent: { forward, strafe, vertical in [-1,1]; dYaw, dPitch in radians }
export function updateFlyCamera(cam, intent, dt) {
  cam.yaw += intent.dYaw;
  cam.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, cam.pitch + intent.dPitch));
  const fwd = [Math.sin(cam.yaw), 0, Math.cos(cam.yaw)];
  const right = [Math.cos(cam.yaw), 0, -Math.sin(cam.yaw)];
  const targetVel = [
    (fwd[0] * intent.forward + right[0] * intent.strafe) * SPEED,
    intent.vertical * SPEED,
    (fwd[2] * intent.forward + right[2] * intent.strafe) * SPEED,
  ];
  const k = 1 - Math.exp(-12 * dt);
  for (let i = 0; i < 3; i++) {
    cam.vel[i] += (targetVel[i] - cam.vel[i]) * k;
    cam.pos[i] += cam.vel[i] * dt;
  }
  return cam;
}
