import { VOXELS as N } from '../constants.js';

function pushVarint(arr, n) {
  do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; arr.push(b); } while (n);
}
function readVarint(bytes, posRef) {
  let n = 0, shift = 0, b;
  do { b = bytes[posRef.p++]; n |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
  return n >>> 0;
}
function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function b64ToBytes(b64) {
  const bin = atob(b64), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function serialize(w) {
  const out = [];
  let i = 0;
  while (i < N) {
    const v = w[i]; let run = 1;
    while (i + run < N && w[i + run] === v) run++;
    out.push(v); pushVarint(out, run);
    i += run;
  }
  return bytesToB64(Uint8Array.from(out));
}

export function deserialize(b64) {
  const bytes = b64ToBytes(b64);
  const w = new Uint8Array(N);
  const ref = { p: 0 }; let i = 0;
  while (ref.p < bytes.length && i < N) {
    const v = bytes[ref.p++];
    const run = readVarint(bytes, ref);
    w.fill(v, i, i + run);
    i += run;
  }
  return w;
}
