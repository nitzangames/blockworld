// Adapts PlaySDK.multiplayer to the { myId, isHost, send, onMessage, onJoin, onLeave } interface
// that session.js consumes. `room` is the object returned by createRoom/joinRoom.
export function makePlayTransport(sdk, room, myUserId) {
  const mp = sdk.multiplayer;
  return {
    myId: () => myUserId,
    isHost: () => room.isHost,
    send: (payload, to) => mp.send(payload, to),
    onMessage: (cb) => mp.onMessage((from, payload) => cb(from, payload)),
    onJoin: (cb) => mp.on('playerJoined', (p) => cb({ userId: p.userId, name: p.displayName || 'Player' })),
    onLeave: (cb) => mp.on('playerLeft', (p) => cb({ userId: p.userId })),
  };
}

// Helper: resolve this client's userId from the SDK, best-effort.
export function currentUserId(sdk) {
  try { return sdk.getUserId ? sdk.getUserId() : null; } catch { return null; }
}
