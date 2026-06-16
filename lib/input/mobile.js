// Creates touch controls. Left half = move joystick; right half of the screen = look-drag.
// Buttons: up/down fly, and ONE action button (acts per the selected palette tool — place a
// color or erase). Produces the same intent shape as desktop.
export function createMobileInput(root, { onAct }) {
  // Look-drag listens on the canvas (which sits under the pointer-events:none HUD overlay), so
  // drags on empty screen reach it while the joystick/buttons capture their own touches.
  const canvas = document.getElementById('c');
  const move = { x: 0, y: 0 };
  const look = { dx: 0, dy: 0 };
  let vertical = 0;
  const LOOK = 0.005;

  root.innerHTML = `
    <div id="stick" style="position:absolute;left:24px;bottom:90px;width:120px;height:120px;border-radius:50%;background:rgba(255,255,255,.12);pointer-events:auto">
      <div id="knob" style="position:absolute;left:40px;top:40px;width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,.5)"></div>
    </div>
    <div style="position:absolute;right:16px;bottom:150px;display:flex;flex-direction:column;gap:8px;pointer-events:auto">
      <button id="flyUp" style="width:56px;height:48px;font-size:20px">▲</button>
      <button id="flyDn" style="width:56px;height:48px;font-size:20px">▼</button>
    </div>
    <div style="position:absolute;right:16px;bottom:32px;pointer-events:auto">
      <button id="act" style="width:92px;height:72px;border-radius:50%;border:0;font-size:14px;font-weight:700;line-height:1.1;background:rgba(255,255,255,.85);color:#1a1a1a">Build /<br>Erase</button>
    </div>`;

  const stick = root.querySelector('#stick'), knob = root.querySelector('#knob');
  let stickId = null; const sc = { x: 0, y: 0 };
  stick.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0]; stickId = t.identifier;
    const r = stick.getBoundingClientRect(); sc.x = r.left + r.width / 2; sc.y = r.top + r.height / 2;
    e.preventDefault();
  }, { passive: false });
  function stickMove(e) {
    for (const t of e.changedTouches) if (t.identifier === stickId) {
      let dx = (t.clientX - sc.x) / 60, dy = (t.clientY - sc.y) / 60;
      const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; }
      move.x = dx; move.y = -dy;
      knob.style.left = 40 + dx * 40 + 'px'; knob.style.top = 40 - move.y * 40 + 'px';
    }
  }
  function stickEnd(e) {
    for (const t of e.changedTouches) if (t.identifier === stickId) {
      stickId = null; move.x = 0; move.y = 0; knob.style.left = '40px'; knob.style.top = '40px';
    }
  }
  stick.addEventListener('touchmove', stickMove, { passive: false });
  stick.addEventListener('touchend', stickEnd);

  let lookId = null; const lp = { x: 0, y: 0 };
  // Any touch that reaches the canvas drives look-drag (drag anywhere to look). The joystick and
  // buttons capture their own touches, so they never reach here. Previously this was gated to the
  // right half of the screen, which silently dropped drags that started on the left.
  canvas.addEventListener('touchstart', (e) => {
    if (lookId !== null) return;
    const t = e.changedTouches[0];
    lookId = t.identifier; lp.x = t.clientX; lp.y = t.clientY;
  }, { passive: true });
  canvas.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) if (t.identifier === lookId) {
      look.dx += -(t.clientX - lp.x) * LOOK; look.dy += -(t.clientY - lp.y) * LOOK;
      lp.x = t.clientX; lp.y = t.clientY;
    }
  }, { passive: true });
  function endLook(e) { for (const t of e.changedTouches) if (t.identifier === lookId) lookId = null; }
  canvas.addEventListener('touchend', endLook);
  canvas.addEventListener('touchcancel', endLook);

  const hold = (el, on, off) => {
    el.addEventListener('touchstart', (e) => { on(); e.preventDefault(); }, { passive: false });
    el.addEventListener('touchend', off);
  };
  hold(root.querySelector('#flyUp'), () => vertical = 1, () => vertical = 0);
  hold(root.querySelector('#flyDn'), () => vertical = -1, () => vertical = 0);
  root.querySelector('#act').addEventListener('touchstart', (e) => { onAct(); e.preventDefault(); }, { passive: false });

  // Reused every frame (no per-frame allocation; consumed synchronously by the loop).
  const intent = { forward: 0, strafe: 0, vertical: 0, dYaw: 0, dPitch: 0 };
  function pollIntent() {
    intent.forward = move.y; intent.strafe = move.x; intent.vertical = vertical;
    intent.dYaw = look.dx; intent.dPitch = look.dy;
    look.dx = 0; look.dy = 0;
    return intent;
  }
  return { pollIntent };
}
