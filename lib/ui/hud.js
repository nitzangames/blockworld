import { PALETTE_HEX } from '../palette.js';
import { isMobile } from '../render/world-view.js';

export function createHUD({ onPick, getSelected }) {
  const pal = document.getElementById('palette');
  PALETTE_HEX.forEach((hex, i) => {
    if (i === 0) return; // skip air
    const sw = document.createElement('button');
    sw.style.cssText = `flex:0 0 auto;width:34px;height:34px;border-radius:8px;border:3px solid transparent;background:${hex};cursor:pointer`;
    sw.dataset.idx = i;
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
