import { playerColor } from '../player/player-color.js';

const THREE = window.THREE;

export function createAvatars(scene) {
  const avatars = new Map(); // userId -> { group, target:{x,y,z,yaw}, head }

  function nameSprite(text) {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
    const g = cv.getContext('2d');
    g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(0, 0, 256, 64);
    g.fillStyle = '#fff'; g.fillText(text.slice(0, 14), 128, 34);
    const tex = new THREE.CanvasTexture(cv);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    spr.scale.set(2.2, 0.55, 1); spr.position.set(0, 2.5, 0);
    return spr;
  }

  function ensure(userId, name) {
    if (avatars.has(userId)) return avatars.get(userId);
    const color = playerColor(userId);
    const group = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.0, 0.35), mat);
    body.position.y = 0.5;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), mat);
    head.position.y = 1.3;
    group.add(body); group.add(head); group.add(nameSprite(name || 'Player'));
    scene.add(group);
    const rec = { group, head, target: { x: 0, y: 0, z: 0, yaw: 0 } };
    avatars.set(userId, rec);
    return rec;
  }

  // p = {x,y,z,yaw,pitch}. The avatar stands ~1.6 below eye height.
  function setTarget(userId, name, p) {
    const rec = ensure(userId, name);
    rec.target = { x: p.x, y: p.y - 1.6, z: p.z, yaw: p.yaw };
  }

  function remove(userId) {
    const rec = avatars.get(userId);
    if (!rec) return;
    scene.remove(rec.group);
    rec.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.map) o.material.map.dispose(); });
    avatars.delete(userId);
  }

  function update(dt) {
    const k = 1 - Math.exp(-12 * dt);
    for (const rec of avatars.values()) {
      const g = rec.group, t = rec.target;
      g.position.x += (t.x - g.position.x) * k;
      g.position.y += (t.y - g.position.y) * k;
      g.position.z += (t.z - g.position.z) * k;
      g.rotation.y += (t.yaw - g.rotation.y) * k;
    }
  }

  function clear() { for (const id of [...avatars.keys()]) remove(id); }

  return { setTarget, remove, update, clear };
}
