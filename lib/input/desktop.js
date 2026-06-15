const KEY = { w:'forward+', s:'forward-', d:'strafe+', a:'strafe-', ' ':'vertical+', shift:'vertical-' };

export function createDesktopInput(canvas, { onAct, onPick, onScroll, onMenu }) {
  const keys = new Set();
  let dYaw = 0, dPitch = 0;
  const LOOK = 0.0022;

  canvas.addEventListener('click', () => { if (document.pointerLockElement !== canvas) canvas.requestPointerLock(); });
  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== canvas) return;
    dYaw -= e.movementX * LOOK; dPitch -= e.movementY * LOOK;
  });
  document.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'escape') { onMenu && onMenu(); return; }
    if (k === 'e' || k === '0') { onPick && onPick(0); return; } // 0 = erase tool
    if (k >= '1' && k <= '9') { onPick && onPick(parseInt(k, 10)); return; }
    keys.add(k === ' ' ? ' ' : k);
  });
  document.addEventListener('keyup', (e) => keys.delete(e.key === ' ' ? ' ' : e.key.toLowerCase()));
  // Single action: left-click (place selected color, or erase if the erase tool is active).
  // No right-click — keep one interaction model shared with mobile tap.
  canvas.addEventListener('mousedown', (e) => {
    if (document.pointerLockElement !== canvas) return;
    if (e.button === 0) onAct && onAct();
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  // Scroll wheel cycles the palette (works while pointer-locked, so you can pick any of the
  // 16 colors without ever releasing the mouse). +1 on scroll down, -1 on scroll up.
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); onScroll && onScroll(Math.sign(e.deltaY)); }, { passive: false });

  // Reused every frame (no per-frame allocation; consumed synchronously by the loop).
  const intent = { forward: 0, strafe: 0, vertical: 0, dYaw: 0, dPitch: 0 };
  function pollIntent() {
    intent.forward = (keys.has('w') ? 1 : 0) - (keys.has('s') ? 1 : 0);
    intent.strafe = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
    intent.vertical = (keys.has(' ') ? 1 : 0) - (keys.has('shift') ? 1 : 0);
    intent.dYaw = dYaw; intent.dPitch = dPitch;
    dYaw = 0; dPitch = 0;
    return intent;
  }
  return { pollIntent, active: () => document.pointerLockElement === canvas };
}
