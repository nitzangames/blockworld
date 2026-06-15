import { applyEdit } from '../voxel/edit.js';
import { serialize, deserialize } from '../voxel/rle.js';
import { T, chunkSnapshot, SnapshotReassembler } from './protocol.js';
import { createPermissions } from './permissions.js';

// hooks: {
//   onSnapshot(world)              visitor: a freshly received world is ready to render
//   applyRemoteEdit(x,y,z,b,dirty) a block changed (re-mesh those chunks)
//   onPos(userId, {x,y,z,yaw,pitch,n})   n = sender's display name
//   onPlayerLeft(userId)
//   onPlayers(list)               host: roster changed (Players panel)
//   onPermChange(canEdit)         visitor: my build right changed
//   onEnded()                     the session ended (host left)
//   worldName                     string
// }
export function createSession({ transport, getWorld, ownerId, myName, hooks }) {
  const isHost = transport.isHost();
  const perms = createPermissions(ownerId);
  const reasm = new SnapshotReassembler();
  let myCanEdit = isHost;

  function applyAndDirty(x, y, z, b) {
    const r = applyEdit(getWorld(), x, y, z, b);
    if (r.ok) hooks.applyRemoteEdit(x, y, z, b, r.dirty);
    return r;
  }

  transport.onMessage((from, p) => {
    switch (p.t) {
      case T.WELCOME: break; // meta only; world arrives via SNAPSHOT
      case T.SNAPSHOT: {
        const blob = reasm.add(p);
        if (blob) hooks.onSnapshot(deserialize(blob));
        break;
      }
      case T.EDIT_REQ: {
        if (!isHost || !perms.canEdit(from)) break; // permission gate (host only)
        const r = applyAndDirty(p.x, p.y, p.z, p.b);
        if (r.ok) transport.send({ t: T.EDIT, x: p.x, y: p.y, z: p.z, b: p.b });
        break;
      }
      case T.EDIT:
        if (!isHost) applyAndDirty(p.x, p.y, p.z, p.b); // host already applied its own
        break;
      case T.POS: hooks.onPos(from, p); break;
      case T.PERM:
        // PERM is sent targeted to the affected visitor, so no self-id match is needed
        // (the SDK exposes no public userId getter — see play-transport).
        if (!isHost) { myCanEdit = p.canEdit; hooks.onPermChange(p.canEdit); }
        break;
      case T.BYE: hooks.onPlayerLeft(from); break;
    }
  });

  if (isHost) {
    transport.onJoin(({ userId, name }) => {
      perms.add(userId, name);
      transport.send({ t: T.WELCOME, name: hooks.worldName }, userId);
      for (const piece of chunkSnapshot(serialize(getWorld()))) {
        transport.send({ t: T.SNAPSHOT, seq: piece.seq, total: piece.total, data: piece.data }, userId);
      }
      hooks.onPlayers(perms.list());
    });
    transport.onLeave(({ userId }) => { perms.remove(userId); hooks.onPlayerLeft(userId); hooks.onPlayers(perms.list()); });
  }

  return {
    isHost,
    canEditLocal() { return isHost || myCanEdit; },
    players() { return perms.list(); },
    requestEdit(x, y, z, b) {
      if (isHost) {
        const r = applyAndDirty(x, y, z, b);
        if (r.ok) transport.send({ t: T.EDIT, x, y, z, b });
      } else if (myCanEdit) {
        transport.send({ t: T.EDIT_REQ, x, y, z, b }); // wait for the authoritative echo
      }
    },
    sendPos(cam) { transport.send({ t: T.POS, x: cam.pos[0], y: cam.pos[1], z: cam.pos[2], yaw: cam.yaw, pitch: cam.pitch, n: myName }); },
    setPermission(userId, canEdit) {
      if (!isHost) return;
      perms.set(userId, canEdit);
      transport.send({ t: T.PERM, canEdit }, userId); // targeted to that visitor
      hooks.onPlayers(perms.list());
    },
  };
}
