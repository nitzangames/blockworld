// Message tags kept to single chars to keep relay payloads small.
export const T = {
  WELCOME: 'w',   // host -> joining visitor: world meta
  SNAPSHOT: 's',  // host -> joining visitor: one RLE-blob piece {seq,total,data}
  EDIT_REQ: 'q',  // visitor -> host: requested block change {x,y,z,b}
  EDIT: 'e',      // host -> all: authoritative block change {x,y,z,b}
  POS: 'p',       // any -> all: {x,y,z,yaw,pitch}
  PERM: 'm',      // host -> all: {userId, canEdit}
  BYE: 'b',       // leaving -> all
};

const MAX_PIECE = 12000; // base64 chars per snapshot message (safely under the relay limit)

export function chunkSnapshot(blob, maxLen = MAX_PIECE) {
  const total = Math.max(1, Math.ceil(blob.length / maxLen));
  const pieces = [];
  for (let i = 0; i < total; i++) {
    pieces.push({ seq: i, total, data: blob.slice(i * maxLen, (i + 1) * maxLen) });
  }
  return pieces;
}

export class SnapshotReassembler {
  constructor() { this.reset(); }
  reset() { this.parts = []; this.total = -1; this.got = 0; }
  // Returns the full blob string once every piece has arrived, else null.
  add(p) {
    if (this.total === -1) { this.total = p.total; this.parts = new Array(p.total); this.got = 0; }
    if (this.parts[p.seq] === undefined) { this.parts[p.seq] = p.data; this.got++; }
    if (this.got === this.total) { const s = this.parts.join(''); this.reset(); return s; }
    return null;
  }
}
