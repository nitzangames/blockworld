// Creates touch controls. Left half = move joystick; right half of the screen = look-drag.
// Buttons: up/down fly, and ONE action button (acts per the selected palette tool — place a
// color or erase). Produces the same intent shape as desktop.
export function createMobileInput(root, { onAct }) {
  // Look-drag listens on the canvas (which sits under the pointer-events:none HUD overlay), so
  // drags on empty screen reach it while the joystick/buttons capture their own touches.
  const canvas = document.getElementById('c');
  let move = { x: 0, y: 0 };
  let look = { dx: 0, dy: 0 };
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
  let stickId = null, sc = { x: 0, y: 0 };
  stick.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0]; stickId = t.identifier;
    const r = stick.getBoundingClientRect(); sc = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    e.preventDefault();
  }, { passive: false });
  function stickMove(e) {
    for (const t of e.changedTouches) if (t.identifier === stickId) {
      let dx = (t.clientX - sc.x) / 60, dy = (t.clientY - sc.y) / 60;
      const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; }
      move = { x: dx, y: -dy };
      knob.style.left = 40 + dx * 40 + 'px'; knob.style.top = 40 - move.y * 40 + 'px';
    }
  }
  function stickEnd(e) {
    for (const t of e.changedTouches) if (t.identifier === stickId) {
      stickId = null; move = { x: 0, y: 0 }; knob.style.left = '40px'; knob.style.top = '40px';
    }
  }
  stick.addEventListener('touchmove', stickMove, { passive: false });
  stick.addEventListener('touchend', stickEnd);

  let lookId = null, lp = { x: 0, y: 0 };
  canvas.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    if (lookId === null && t.clientX > window.innerWidth / 2) { lookId = t.identifier; lp = { x: t.clientX, y: t.clientY }; }
  }, { passive: true });
  canvas.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) if (t.identifier === lookId) {
      look.dx += -(t.clientX - lp.x) * LOOK; look.dy += -(t.clientY - lp.y) * LOOK;
      lp = { x: t.clientX, y: t.clientY };
    }
  }, { passive: true });
  canvas.addEventListener('touchend', (e) => {
    for (const t of e.changedTouches) if (t.identifier === lookId) lookId = null;
  });

  const hold = (el, on, off) => {
    el.addEventListener('touchstart', (e) => { on(); e.preventDefault(); }, { passive: false });
    el.addEventListener('touchend', off);
  };
  hold(root.querySelector('#flyUp'), () => vertical = 1, () => vertical = 0);
  hold(root.querySelector('#flyDn'), () => vertical = -1, () => vertical = 0);
  root.querySelector('#act').addEventListener('touchstart', (e) => { onAct(); e.preventDefault(); }, { passive: false });

  function pollIntent() {
    const intent = { forward: move.y, strafe: move.x, vertical, dYaw: look.dx, dPitch: look.dy };
    look = { dx: 0, dy: 0 };
    return intent;
  }
  return { pollIntent };
}
