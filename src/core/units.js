/**
 * Conversoes de unidades, cores e fontes entre o mundo Delphi/FastReport e o
 * mundo CSS.
 *
 * O FastReport grava todas as coordenadas em "pixels de tela" a 96 dpi, mas o
 * papel e descrito em milimetros (PaperWidth/PaperHeight). Cores sao TColor do
 * Delphi (inteiro BGR) e a altura da fonte segue a convencao negativa do
 * Windows (Height = -pixels).
 */

export const PX_PER_MM = 96 / 25.4; // 3.779527...
export const PX_PER_INCH = 96;

export const mmToPx = (mm) => mm * PX_PER_MM;
export const pxToMm = (px) => px / PX_PER_MM;
export const pxToPt = (px) => (px * 72) / 96;
export const ptToPx = (pt) => (pt * 96) / 72;

/** clNone do Delphi: usado pelo FastReport para "sem preenchimento". */
export const CL_NONE = 0x1fffffff;

/** Arredonda e remove zeros a direita, no formato que o FastReport usa. */
export function formatNumber(value, decimals = 5) {
  if (!Number.isFinite(value)) return '0';
  const fixed = Number(value).toFixed(decimals);
  return fixed.replace(/\.?0+$/, '') || '0';
}

export function parseNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

/** TColor (BGR) -> `#rrggbb`. Retorna null para clNone/cores de sistema. */
export function colorToCss(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n === CL_NONE || n > 0xffffff) return null;
  const b = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const r = n & 0xff;
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
}

/** `#rrggbb` -> TColor (BGR). */
export function cssToColor(css) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(css || '').trim());
  if (!m) return 0;
  const int = parseInt(m[1], 16);
  const r = (int >> 16) & 0xff;
  const g = (int >> 8) & 0xff;
  const b = int & 0xff;
  return (b << 16) | (g << 8) | r;
}

/** Bits de TfrxFont.Style (fsBold=1, fsItalic=2, fsUnderline=4, fsStrikeOut=8). */
export const FONT_STYLE = { bold: 1, italic: 2, underline: 4, strikeout: 8 };

/** Bits de TfrxFrame.Typ. */
export const FRAME_BITS = { left: 1, right: 2, top: 4, bottom: 8 };

export const FRAME_STYLES = {
  fsSolid: 'solid',
  fsDash: 'dashed',
  fsDot: 'dotted',
  fsDashDot: 'dashed',
  fsDashDotDot: 'dashed',
  fsDouble: 'double',
  fsAltDot: 'dotted',
  fsSquare: 'solid',
};

/** Altura Delphi (-11) -> tamanho em px para o CSS. */
export function fontHeightToPx(height) {
  const n = parseNumber(height, -13);
  return Math.abs(n) || 13;
}

/** Tamanho em pt -> altura Delphi negativa. */
export function ptToFontHeight(pt) {
  return -Math.round(ptToPx(parseNumber(pt, 10)));
}

export function fontHeightToPt(height) {
  return Math.round(pxToPt(fontHeightToPx(height)) * 10) / 10;
}

export const H_ALIGN_CSS = {
  haLeft: 'left',
  haRight: 'right',
  haCenter: 'center',
  haBlock: 'justify',
};

export const V_ALIGN_CSS = {
  vaTop: 'flex-start',
  vaCenter: 'center',
  vaBottom: 'flex-end',
};

/** Converte um valor de tamanho para a unidade da interface. */
export function toDisplayUnit(px, unit) {
  return unit === 'mm' ? pxToMm(px) : px;
}

export function fromDisplayUnit(value, unit) {
  return unit === 'mm' ? mmToPx(value) : value;
}
