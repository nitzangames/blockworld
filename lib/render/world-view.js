import { meshChunk } from '../voxel/mesher.js';
import { NCX, NCY, NCZ, CHUNK, WX, WZ } from '../constants.js';

const THREE = window.THREE;

export function createWorldView(canvas, world) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isMobile(), preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile() ? 1.5 : 2));
  renderer.setClearColor(0x9ec7e8);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x9ec7e8, 60, 180);
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 400);

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const sun = new THREE.DirectionalLight(0xffffff, 0.8);
  sun.position.set(0.5, 1, 0.3);
  scene.add(sun);

  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const meshes = new Map(); // chunkId → THREE.Mesh

  // Black wireframe box highlighting the block under the crosshair. Slightly oversized to sit
  // just outside the block faces and avoid z-fighting.
  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.02, 1.02, 1.02)),
    new THREE.LineBasicMaterial({ color: 0x000000 })
  );
  outline.visible = false;
  scene.add(outline);

  // cell = [x,y,z] integer voxel coords, or null to hide. A block at cell occupies [cell,cell+1],
  // so its center is cell + 0.5.
  function setHighlight(cell) {
    if (!cell) { outline.visible = false; return; }
    outline.position.set(cell[0] + 0.5, cell[1] + 0.5, cell[2] + 0.5);
    outline.visible = true;
  }

  function chunkCoords(id) {
    const cx = id % NCX;
    const cz = ((id / NCX) | 0) % NCZ;
    const cy = (id / (NCX * NCZ)) | 0;
    return [cx, cy, cz];
  }

  function rebuildChunk(id) {
    const [cx, cy, cz] = chunkCoords(id);
    const g = meshChunk(world, cx, cy, cz);
    let mesh = meshes.get(id);
    if (g.indices.length === 0) {
      if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); meshes.delete(id); }
      return;
    }
    if (!mesh) {
      mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
      meshes.set(id, mesh); scene.add(mesh);
    }
    const geo = mesh.geometry;
    geo.setAttribute('position', new THREE.BufferAttribute(g.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(g.normals, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(g.colors, 3));
    geo.setIndex(new THREE.BufferAttribute(g.indices, 1));
    geo.computeBoundingSphere();
  }

  function rebuildAll() {
    for (let id = 0; id < NCX * NCY * NCZ; id++) rebuildChunk(id);
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize); resize();

  function render(cam) {
    camera.position.set(cam.pos[0], cam.pos[1], cam.pos[2]);
    const cp = Math.cos(cam.pitch);
    camera.lookAt(
      cam.pos[0] + Math.sin(cam.yaw) * cp,
      cam.pos[1] + Math.sin(cam.pitch),
      cam.pos[2] + Math.cos(cam.yaw) * cp
    );
    renderer.render(scene, camera);
  }

  return { renderer, scene, camera, rebuildChunk, rebuildAll, render, resize, setHighlight };
}

export function isMobile() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || 'ontouchstart' in window;
}
