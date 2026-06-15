import { PALETTE_HEX } from '../palette.js';
import { isMobile } from '../render/world-view.js';

export function createHUD({ onPick, getSelected }) {
  const pal = document.getElementById('palette');
  pal.innerHTML = '';
  PALETTE_HEX.forEach((hex, i) => {
    const sw = document.createElement('button');
    sw.dataset.idx = i;
    if (i === 0) {
      // index 0 = the erase tool (remove blocks), shown as a distinct eraser button
      sw.textContent = '⌫';
      sw.title = 'Erase';
      sw.style.cssText = 'flex:0 0 auto;width:34px;height:34px;border-radius:8px;border:3px solid transparent;background:#2b2b2b;color:#fff;font-size:16px;line-height:1;cursor:pointer';
    } else {
      sw.style.cssText = `flex:0 0 auto;width:34px;height:34px;border-radius:8px;border:3px solid transparent;background:${hex};cursor:pointer`;
    }
    sw.addEventListener('click', () => onPick(i));
    pal.appendChild(sw);
  });
  function refresh() {
    [...pal.children].forEach((sw) =>
      sw.style.borderColor = (+sw.dataset.idx === getSelected()) ? '#fff' : 'transparent');
  }
  refresh();
  return { refresh, isMobile: isMobile() };
}
