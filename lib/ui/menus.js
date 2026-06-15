// Minimal DOM menus. showMainMenu shows a full-screen My Worlds overlay; createInWorldMenu
// builds the panel toggled by the ☰ button.
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function relTime(ts) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60); if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

// worlds: [{id,name,updatedAt}]. Callbacks: onOpen(id), onNew(name), onRename(id,name),
// onDelete(id), onJoin(code). Returns { setStatus, setWorlds, close }.
export function showMainMenu({ worlds, displayName, onOpen, onNew, onRename, onDelete, onJoin }) {
  let list = worlds.slice();
  const el = document.createElement('div');
  el.id = 'mainmenu';
  el.style.cssText = 'position:absolute;inset:0;z-index:10;display:flex;align-items:center;justify-content:center;background:rgba(15,17,21,.93);color:#fff;font-family:system-ui,sans-serif;pointer-events:auto;overflow:auto';
  document.body.appendChild(el);

  function button(label, onClick, bg) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = `border:0;border-radius:8px;padding:7px 10px;cursor:pointer;font-size:14px;color:#fff;background:${bg || '#3a3f47'}`;
    b.onclick = onClick;
    return b;
  }

  function render() {
    el.innerHTML = `
      <div style="width:330px;max-width:92vw;padding:22px;background:#14171c;border-radius:16px">
        <h1 style="margin:0 0 2px;font-size:28px">BlockWorld</h1>
        <div style="opacity:.6;font-size:12px;margin-bottom:14px">${displayName ? 'Signed in as ' + esc(displayName) : 'Playing as guest'}</div>
        <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.6;margin-bottom:6px">My Worlds</div>
        <div id="mm-worlds" style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px"></div>
        <div style="display:flex;gap:6px;margin-bottom:14px">
          <input id="mm-newname" placeholder="New world name" style="flex:1;height:40px;border-radius:8px;border:2px solid #333;background:#1a1d23;color:#fff;padding:0 10px;font-size:14px">
          <button id="mm-new" style="height:40px;border:0;border-radius:8px;background:#5EA918;color:#fff;font-weight:600;padding:0 14px;cursor:pointer">Create</button>
        </div>
        <div style="text-align:center;opacity:.4;font-size:12px;margin-bottom:10px">— or join a friend —</div>
        <div style="display:flex;gap:6px">
          <input id="mm-code" placeholder="CODE" maxlength="6" style="flex:1;height:40px;text-align:center;text-transform:uppercase;border-radius:8px;border:2px solid #333;background:#1a1d23;color:#fff;font-size:16px">
          <button id="mm-join" style="height:40px;border:0;border-radius:8px;background:#3C44AA;color:#fff;font-weight:600;padding:0 14px;cursor:pointer">Join</button>
        </div>
        <div id="mm-status" style="height:16px;font-size:12px;color:#f8c627;margin-top:8px"></div>
      </div>`;

    const box = el.querySelector('#mm-worlds');
    if (!list.length) {
      box.innerHTML = '<div style="opacity:.5;font-size:13px;padding:4px 0">No worlds yet — name one below.</div>';
    }
    list.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).forEach((w) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:6px;background:#1c2027;border-radius:8px;padding:6px 8px';
      const info = document.createElement('div');
      info.style.cssText = 'flex:1;min-width:0';
      const name = document.createElement('div');
      name.textContent = w.name; name.style.cssText = 'font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      const time = document.createElement('div');
      time.textContent = w.updatedAt ? 'edited ' + relTime(w.updatedAt) : '';
      time.style.cssText = 'font-size:11px;opacity:.5';
      info.append(name, time);
      row.appendChild(info);
      row.appendChild(button('Open', () => onOpen(w.id), '#5EA918'));
      row.appendChild(button('✎', () => startRename(row, info, w)));
      row.appendChild(button('🗑', () => startDelete(row, w), '#7a2620'));
      box.appendChild(row);
    });

    el.querySelector('#mm-new').onclick = () => {
      const inp = el.querySelector('#mm-newname');
      const n = inp.value.trim();
      if (!n) { setStatus('Enter a world name'); inp.focus(); return; }
      onNew(n);
    };
    el.querySelector('#mm-join').onclick = () => {
      const c = el.querySelector('#mm-code').value.trim().toUpperCase();
      if (!c) { setStatus('Enter a code'); return; }
      onJoin(c);
    };
  }

  function startRename(row, nameSpan, w) {
    const inp = document.createElement('input');
    inp.value = w.name;
    inp.style.cssText = 'flex:1;height:30px;border-radius:6px;border:2px solid #4c8bf5;background:#11141a;color:#fff;padding:0 8px;font-size:14px';
    row.replaceChild(inp, nameSpan); inp.focus(); inp.select();
    const commit = () => { const n = inp.value.trim(); if (n && n !== w.name) onRename(w.id, n); else render(); };
    inp.onkeydown = (e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') render(); };
    inp.onblur = commit;
  }

  function startDelete(row, w) {
    row.innerHTML = '';
    const q = document.createElement('span');
    q.textContent = `Delete "${w.name}"?`; q.style.cssText = 'flex:1;font-size:14px';
    row.appendChild(q);
    row.appendChild(button('Delete', () => onDelete(w.id), '#b02e26'));
    row.appendChild(button('Cancel', () => render(), '#3a3f47'));
  }

  function setStatus(t) { const s = el.querySelector('#mm-status'); if (s) s.textContent = t; }
  render();
  return {
    setStatus,
    setWorlds: (next) => { list = next.slice(); render(); },
    close: () => el.remove(),
  };
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
