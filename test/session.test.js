import { describe, it, expect } from 'vitest';
import { createWorld, fillFloor, setBlock, getBlock } from '../lib/voxel/store.js';
import { createSession } from '../lib/net/session.js';

// A synchronous in-memory network: messages deliver immediately (deterministic tests).
function makeNetwork() {
  const onMsg = {}, onJoin = {}, onLeave = {};
  function transportFor(id, host) {
    return {
      myId: () => id, isHost: () => host,
      send(payload, to) {
        const copy = () => JSON.parse(JSON.stringify(payload));
        if (to) { if (to !== id && onMsg[to]) onMsg[to](id, copy()); return; }
        for (const uid of Object.keys(onMsg)) if (uid !== id) onMsg[uid](id, copy());
      },
      onMessage(cb) { onMsg[id] = cb; },
      onJoin(cb) { onJoin[id] = cb; },
      onLeave(cb) { onLeave[id] = cb; },
    };
  }
  return {
    transportFor,
    join: (hostId, who) => onJoin[hostId] && onJoin[hostId](who),
    leave: (hostId, who) => onLeave[hostId] && onLeave[hostId](who),
  };
}

function noopHooks(extra = {}) {
  return Object.assign({
    onSnapshot() {}, applyRemoteEdit() {}, onPos() {}, onPlayerLeft() {},
    onPlayers() {}, onPermChange() {}, onEnded() {}, worldName: 'W',
  }, extra);
}

describe('session', () => {
  it('streams the world to a joining visitor', () => {
    const net = makeNetwork();
    const hw = createWorld(); fillFloor(hw, 8); setBlock(hw, 3, 1, 3, 5);
    createSession({ transport: net.transportFor('host', true), getWorld: () => hw, ownerId: 'host', hooks: noopHooks() });
    let vw = null;
    createSession({ transport: net.transportFor('vis', false), getWorld: () => vw, ownerId: 'host',
      hooks: noopHooks({ onSnapshot: (w) => { vw = w; } }) });
    net.join('host', { userId: 'vis', name: 'Vee' });
    expect(vw).not.toBeNull();
    expect(getBlock(vw, 3, 1, 3)).toBe(5);
    expect(getBlock(vw, 0, 0, 0)).toBe(8);
  });

  it('a granted visitor edit syncs to the host and back', () => {
    const net = makeNetwork();
    const hw = createWorld(); fillFloor(hw, 8);
    const host = createSession({ transport: net.transportFor('host', true), getWorld: () => hw, ownerId: 'host', hooks: noopHooks() });
    let vw = null;
    const vis = createSession({ transport: net.transportFor('vis', false), getWorld: () => vw, ownerId: 'host',
      hooks: noopHooks({ onSnapshot: (w) => { vw = w; } }) });
    net.join('host', { userId: 'vis', name: 'Vee' });
    host.setPermission('vis', true);
    vis.requestEdit(5, 2, 5, 7);
    expect(getBlock(hw, 5, 2, 5)).toBe(7);   // host applied
    expect(getBlock(vw, 5, 2, 5)).toBe(7);   // echoed to visitor
  });

  it('an ungranted visitor cannot edit', () => {
    const net = makeNetwork();
    const hw = createWorld(); fillFloor(hw, 8);
    createSession({ transport: net.transportFor('host', true), getWorld: () => hw, ownerId: 'host', hooks: noopHooks() });
    let vw = null;
    const vis = createSession({ transport: net.transportFor('vis', false), getWorld: () => vw, ownerId: 'host',
      hooks: noopHooks({ onSnapshot: (w) => { vw = w; } }) });
    net.join('host', { userId: 'vis', name: 'Vee' });
    vis.requestEdit(5, 2, 5, 7);              // not granted
    expect(getBlock(hw, 5, 2, 5)).toBe(0);
  });

  it('host edits broadcast to visitors', () => {
    const net = makeNetwork();
    const hw = createWorld(); fillFloor(hw, 8);
    const host = createSession({ transport: net.transportFor('host', true), getWorld: () => hw, ownerId: 'host', hooks: noopHooks() });
    let vw = null;
    createSession({ transport: net.transportFor('vis', false), getWorld: () => vw, ownerId: 'host',
      hooks: noopHooks({ onSnapshot: (w) => { vw = w; } }) });
    net.join('host', { userId: 'vis', name: 'Vee' });
    host.requestEdit(1, 2, 1, 9);
    expect(getBlock(vw, 1, 2, 1)).toBe(9);
  });
});
