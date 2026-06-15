// Minimal DOM menus. showMainMenu shows a full-screen overlay; the caller starts hosting/joining
// via the onHost/onJoin callbacks. createInWorldMenu builds the panel toggled by the ☰ button.
export function showMainMenu({ onHost, onJoin, displayName }) {
  const el = document.createElement('div');
  el.id = 'mainmenu';
  el.style.cssText = 'position:absolute;inset:0;z-index:10;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:rgba(15,17,21,.92);color:#fff;font-family:system-ui,sans-serif;pointer-events:auto';
  el.innerHTML = `
    <h1 style="margin:0 0 6px;font-size:30px">BlockWorld</h1>
    <div style="opacity:.7;font-size:13px">${displayName ? 'Signed in as ' + displayName : 'Playing as guest'}</div>
    <button id="mm-host" style="width:240px;height:52px;font-size:17px;font-weight:600;border:0;border-radius:10px;background:#5EA918;color:#fff;cursor:pointer">Play My World</button>
    <div style="display:flex;gap:8px">
      <input id="mm-code" placeholder="CODE" maxlength="6" style="width:120px;height:48px;text-align:center;font-size:18px;text-transform:uppercase;border-radius:10px;border:2px solid #444;background:#1a1d23;color:#fff">
      <button id="mm-join" style="width:112px;height:52px;font-size:16px;font-weight:600;border:0;border-radius:10px;background:#3C44AA;color:#fff;cursor:pointer">Join</button>
    </div>
    <div id="mm-status" style="height:18px;font-size:13px;color:#f8c627"></div>`;
  document.body.appendChild(el);
  const status = el.querySelector('#mm-status');
  el.querySelector('#mm-host').onclick = () => { status.textContent = 'Starting…'; onHost(); };
  el.querySelector('#mm-join').onclick = () => {
    const code = el.querySelector('#mm-code').value.trim().toUpperCase();
    if (!code) { status.textContent = 'Enter a code'; return; }
    status.textContent = 'Joining…'; onJoin(code);
  };
  return { setStatus: (t) => { status.textContent = t; }, close: () => el.remove() };
}

// In-world panel toggled by the ☰ button. getState() returns
// { isHost, code, players:[{userId,name,canEdit}] }. onToggle(userId,canEdit), onLeave().
export function createInWorldMenu({ getState, onToggle, onLeave }) {
  let el = null;
  function render() {
    const s = getState();
    el.innerHTML = `
      <div style="font-weight:700;font-size:16px;margin-bottom:8px">Menu</div>
      ${s.isHost ? `<div style="margin-bottom:8px">Share code: <b style="font-size:20px;letter-spacing:2px">${s.code || '…'}</b></div>` : ''}
      <div style="font-size:13px;opacity:.7;margin-bottom:4px">Players</div>
      <div id="iw-players"></div>
      <button id="iw-leave" style="margin-top:12px;width:100%;height:40px;border:0;border-radius:8px;background:#b02e26;color:#fff;cursor:pointer">Leave</button>`;
    const list = el.querySelector('#iw-players');
    if (!s.players.length) list.innerHTML = '<div style="opacity:.5;font-size:13px">No one else here yet</div>';
    s.players.forEach((p) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:4px 0';
      row.innerHTML = `<span>${p.name}</span>`;
      if (s.isHost) {
        const btn = document.createElement('button');
        btn.textContent = p.canEdit ? 'Can build ✓' : 'View only';
        btn.style.cssText = `border:0;border-radius:6px;padding:4px 8px;cursor:pointer;background:${p.canEdit ? '#5EA918' : '#444'};color:#fff`;
        btn.onclick = () => onToggle(p.userId, !p.canEdit);
        row.appendChild(btn);
      }
      list.appendChild(row);
    });
    el.querySelector('#iw-leave').onclick = onLeave;
  }
  return {
    toggle() {
      if (el) { el.remove(); el = null; return; }
      el = document.createElement('div');
      el.style.cssText = 'position:absolute;top:48px;left:12px;z-index:11;width:260px;background:rgba(20,23,28,.96);color:#fff;border-radius:12px;padding:14px;font-family:system-ui,sans-serif;pointer-events:auto';
      document.body.appendChild(el); render();
    },
    refresh() { if (el) render(); },
    close() { if (el) { el.remove(); el = null; } },
  };
}
