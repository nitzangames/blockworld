import { CHUNK, WX, WY, WZ } from '../constants.js';
import { PALETTE_RGB } from '../palette.js';

function solid(w, x, y, z) {
  if (x < 0 || x >= WX || y < 0 || y >= WY || z < 0 || z >= WZ) return 0;
  return w[x + z * WX + y * WX * WZ];
}

const FACES = [
  { dir: [ 1, 0, 0], corners: [ [1,0,0],[1,1,0],[1,1,1],[1,0,1] ],
    ao: [ [[0,-1,0],[0,0,-1],[0,-1,-1]], [[0,1,0],[0,0,-1],[0,1,-1]], [[0,1,0],[0,0,1],[0,1,1]], [[0,-1,0],[0,0,1],[0,-1,1]] ] },
  { dir: [-1, 0, 0], corners: [ [0,0,1],[0,1,1],[0,1,0],[0,0,0] ],
    ao: [ [[0,-1,0],[0,0,1],[0,-1,1]], [[0,1,0],[0,0,1],[0,1,1]], [[0,1,0],[0,0,-1],[0,1,-1]], [[0,-1,0],[0,0,-1],[0,-1,-1]] ] },
  { dir: [0, 1, 0], corners: [ [0,1,1],[1,1,1],[1,1,0],[0,1,0] ],
    ao: [ [[-1,0,0],[0,0,1],[-1,0,1]], [[1,0,0],[0,0,1],[1,0,1]], [[1,0,0],[0,0,-1],[1,0,-1]], [[-1,0,0],[0,0,-1],[-1,0,-1]] ] },
  { dir: [0,-1, 0], corners: [ [0,0,0],[1,0,0],[1,0,1],[0,0,1] ],
    ao: [ [[-1,0,0],[0,0,-1],[-1,0,-1]], [[1,0,0],[0,0,-1],[1,0,-1]], [[1,0,0],[0,0,1],[1,0,1]], [[-1,0,0],[0,0,1],[-1,0,1]] ] },
  { dir: [0, 0, 1], corners: [ [1,0,1],[1,1,1],[0,1,1],[0,0,1] ],
    ao: [ [[1,0,0],[0,-1,0],[1,-1,0]], [[1,0,0],[0,1,0],[1,1,0]], [[-1,0,0],[0,1,0],[-1,1,0]], [[-1,0,0],[0,-1,0],[-1,-1,0]] ] },
  { dir: [0, 0,-1], corners: [ [0,0,0],[0,1,0],[1,1,0],[1,0,0] ],
    ao: [ [[-1,0,0],[0,-1,0],[-1,-1,0]], [[-1,0,0],[0,1,0],[-1,1,0]], [[1,0,0],[0,1,0],[1,1,0]], [[1,0,0],[0,-1,0],[1,-1,0]] ] },
];

const AO_LEVELS = [0.45, 0.65, 0.82, 1.0];
function aoBrightness(w, ax, ay, az, tri) {
  const s1 = solid(w, ax + tri[0][0], ay + tri[0][1], az + tri[0][2]) ? 1 : 0;
  const s2 = solid(w, ax + tri[1][0], ay + tri[1][1], az + tri[1][2]) ? 1 : 0;
  const c  = solid(w, ax + tri[2][0], ay + tri[2][1], az + tri[2][2]) ? 1 : 0;
  const level = (s1 && s2) ? 0 : (3 - (s1 + s2 + c));
  return AO_LEVELS[level];
}

const EDGE_EPS = 0.002; // lift edge lines just off the face so they don't z-fight the surface

export function meshChunk(w, cx, cy, cz) {
  const positions = [], colors = [], normals = [], indices = [], edges = [];
  const x0 = cx * CHUNK, y0 = cy * CHUNK, z0 = cz * CHUNK;
  let vbase = 0;
  for (let y = y0; y < y0 + CHUNK; y++)
    for (let z = z0; z < z0 + CHUNK; z++)
      for (let x = x0; x < x0 + CHUNK; x++) {
        const b = solid(w, x, y, z);
        if (!b) continue;
        const rgb = PALETTE_RGB[b];
        for (let f = 0; f < 6; f++) {
          const fd = FACES[f].dir;
          if (solid(w, x + fd[0], y + fd[1], z + fd[2])) continue;
          const ax = x + fd[0], ay = y + fd[1], az = z + fd[2];
          const ev = []; // this face's 4 corners, nudged out along the normal, for edge lines
          for (let ci = 0; ci < 4; ci++) {
            const co = FACES[f].corners[ci];
            positions.push(x + co[0], y + co[1], z + co[2]);
            normals.push(fd[0], fd[1], fd[2]);
            const ao = aoBrightness(w, ax, ay, az, FACES[f].ao[ci]);
            colors.push(rgb[0] * ao, rgb[1] * ao, rgb[2] * ao);
            ev.push(x + co[0] + fd[0] * EDGE_EPS, y + co[1] + fd[1] * EDGE_EPS, z + co[2] + fd[2] * EDGE_EPS);
          }
          indices.push(vbase, vbase + 1, vbase + 2, vbase, vbase + 2, vbase + 3);
          vbase += 4;
          // 4 border segments of the quad (outline of this cube face)
          for (let k = 0; k < 4; k++) {
            const a = k * 3, c = ((k + 1) % 4) * 3;
            edges.push(ev[a], ev[a + 1], ev[a + 2], ev[c], ev[c + 1], ev[c + 2]);
          }
        }
      }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Float32Array(colors),
    indices: new Uint32Array(indices),
    edges: new Float32Array(edges),
  };
}
