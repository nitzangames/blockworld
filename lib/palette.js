// Index 0 = air (unused color slot kept for 1:1 index alignment with block bytes).
export const PALETTE_HEX = [
  '#000000', // 0 air (never rendered)
  '#E9ECEC','#8E8E86','#3B4044','#1D1C21','#B02E26','#F07613','#F8C627','#5EA918',
  '#5E7C16','#157788','#3AAFD9','#3C44AA','#8932B8','#BD44B3','#ED8DAC','#835432'
];
export const PALETTE_RGB = PALETTE_HEX.map((h) => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
});
