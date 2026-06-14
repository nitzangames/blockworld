const KEY = { w:'forward+', s:'forward-', d:'strafe+', a:'strafe-', ' ':'vertical+', shift:'vertical-' };

export function createDesktopInput(canvas, { onPlace, onBreak, onPick, onMenu }) {
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
    if (k >= '1' && k <= '9') { onPick && onPick(parseInt(k, 10)); return; }
    keys.add(k === ' ' ? ' ' : k);
  });
  document.addEventListener('keyup', (e) => keys.delete(e.key === ' ' ? ' ' : e.key.toLowerCase()));
  canvas.addEventListener('mousedown', (e) => {
    if (document.pointerLockElement !== canvas) return;
    if (e.button === 0) onBreak && onBreak();
    if (e.button === 2) onPlace && onPlace();
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  function pollIntent() {
    const axis = (plus, minus) => (keys.has(plus) ? 1 : 0) - (keys.has(minus) ? 1 : 0);
    const intent = {
      forward: axis('w', 's'),
      strafe: axis('d', 'a'),
      vertical: axis(' ', 'shift'),
      dYaw, dPitch,
    };
    dYaw = 0; dPitch = 0;
    return intent;
  }
  return { pollIntent, active: () => document.pointerLockElement === canvas };
}
