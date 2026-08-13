/**
 * Renderizacao dos objetos FR3 em DOM.
 *
 * O mesmo codigo serve para a area de edicao e para a pre-visualizacao; a
 * diferenca e o `options.resolve`, que troca as expressoes `[campo]` pelos
 * valores de teste quando estamos em modo de visualizacao.
 */

import {
  colorToCss,
  fontHeightToPx,
  FONT_STYLE,
  FRAME_BITS,
  FRAME_STYLES,
  H_ALIGN_CSS,
  V_ALIGN_CSS,
} from './units.js';
import { propDataToDataUrl } from './picture.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const pictureCache = new WeakMap();

/** Substitui `[expr]` pelos valores informados. */
export function resolveText(text, values, options = {}) {
  if (!text) return '';
  return text.replace(/\[([^[\]]+)\]/g, (all, expr) => {
    const key = expr.trim();
    if (values && Object.prototype.hasOwnProperty.call(values, key) && values[key] !== '') {
      return values[key];
    }
    return options.keepUnknown === false ? '' : all;
  });
}

function applyFrame(el, doc, node) {
  const typ = doc.num(node, 'Frame.Typ', 0);
  const width = doc.num(node, 'Frame.Width', 1) || 1;
  const color = colorToCss(doc.num(node, 'Frame.Color', 0)) || '#000';
  const style = FRAME_STYLES[doc.str(node, 'Frame.Style', 'fsSolid')] || 'solid';
  const border = `${width}px ${style} ${color}`;
  el.style.borderLeft = typ & FRAME_BITS.left ? border : '';
  el.style.borderRight = typ & FRAME_BITS.right ? border : '';
  el.style.borderTop = typ & FRAME_BITS.top ? border : '';
  el.style.borderBottom = typ & FRAME_BITS.bottom ? border : '';
}

function applyFill(el, doc, node) {
  const fill = colorToCss(doc.num(node, 'Color', -1));
  el.style.background = fill || 'transparent';
}

function applyRect(el, doc, node) {
  const rect = doc.rect(node);
  el.style.left = rect.left + 'px';
  el.style.top = rect.top + 'px';
  el.style.width = rect.width + 'px';
  el.style.height = rect.height + 'px';
  return rect;
}

function renderMemo(doc, node, options) {
  const el = document.createElement('div');
  el.className = 'fr-obj fr-memo';
  applyRect(el, doc, node);
  applyFill(el, doc, node);
  applyFrame(el, doc, node);

  const style = doc.num(node, 'Font.Style', 0);
  el.style.fontFamily = `"${doc.str(node, 'Font.Name', 'Arial').replace(/^@/, '')}", Arial, sans-serif`;
  el.style.fontSize = fontHeightToPx(doc.str(node, 'Font.Height', '-13')) + 'px';
  el.style.fontWeight = style & FONT_STYLE.bold ? '700' : '400';
  el.style.fontStyle = style & FONT_STYLE.italic ? 'italic' : 'normal';
  const decorations = [];
  if (style & FONT_STYLE.underline) decorations.push('underline');
  if (style & FONT_STYLE.strikeout) decorations.push('line-through');
  el.style.textDecoration = decorations.join(' ') || 'none';
  el.style.color = colorToCss(doc.num(node, 'Font.Color', 0)) || '#000';
  el.style.justifyContent = V_ALIGN_CSS[doc.str(node, 'VAlign', 'vaTop')] || 'flex-start';

  const inner = document.createElement('div');
  inner.className = 'fr-memo-text';
  inner.style.textAlign = H_ALIGN_CSS[doc.str(node, 'HAlign', 'haLeft')] || 'left';
  inner.style.whiteSpace = doc.bool(node, 'WordWrap', true) ? 'pre-wrap' : 'pre';
  inner.style.lineHeight = doc.num(node, 'LineSpacing', 2) ? '1.16' : '1.16';

  const raw = doc.str(node, 'Text', '');
  const text = options.resolve ? resolveText(raw, options.values, options) : raw;
  inner.textContent = text;
  // Na pre-visualizacao, destaca o que ficou sem valor de teste.
  if (options.resolve && /\[[^[\]]+\]/.test(text)) el.classList.add('fr-unresolved');
  el.appendChild(inner);

  const rotation = doc.num(node, 'Rotation', 0);
  if (rotation) {
    el.style.transform = `rotate(${-rotation}deg)`;
    el.style.transformOrigin = 'center center';
  }
  if (!doc.bool(node, 'Visible', true)) el.classList.add('fr-hidden');
  return el;
}

function renderLine(doc, node) {
  const el = document.createElement('div');
  el.className = 'fr-obj fr-line';
  const rect = applyRect(el, doc, node);
  const color = colorToCss(doc.num(node, 'Color', 0)) || '#000';
  const width = doc.num(node, 'Frame.Width', 1) || 1;
  const dash = FRAME_STYLES[doc.str(node, 'Frame.Style', 'fsSolid')] || 'solid';

  const w = Math.max(rect.width, 1);
  const h = Math.max(rect.height, 1);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.style.overflow = 'visible';

  const line = document.createElementNS(SVG_NS, 'line');
  const diagonal = doc.bool(node, 'Diagonal', false);
  const half = width / 2;
  if (diagonal) {
    line.setAttribute('x1', '0');
    line.setAttribute('y1', '0');
    line.setAttribute('x2', String(w));
    line.setAttribute('y2', String(h));
  } else if (rect.height <= rect.width) {
    line.setAttribute('x1', '0');
    line.setAttribute('y1', String(half));
    line.setAttribute('x2', String(w));
    line.setAttribute('y2', String(half));
  } else {
    line.setAttribute('x1', String(half));
    line.setAttribute('y1', '0');
    line.setAttribute('x2', String(half));
    line.setAttribute('y2', String(h));
  }
  line.setAttribute('stroke', color);
  line.setAttribute('stroke-width', String(width));
  if (dash === 'dashed') line.setAttribute('stroke-dasharray', String(width * 4));
  if (dash === 'dotted') line.setAttribute('stroke-dasharray', `${width} ${width * 2}`);
  svg.appendChild(line);
  el.appendChild(svg);
  el.style.height = rect.height + 'px';
  if (!doc.bool(node, 'Visible', true)) el.classList.add('fr-hidden');
  return el;
}

function renderShape(doc, node) {
  const el = document.createElement('div');
  el.className = 'fr-obj fr-shape';
  const rect = applyRect(el, doc, node);
  const w = Math.max(rect.width, 1);
  const h = Math.max(rect.height, 1);
  const stroke = colorToCss(doc.num(node, 'Frame.Color', 0)) || '#000';
  const strokeWidth = doc.num(node, 'Frame.Width', 1) || 1;
  const fill = colorToCss(doc.num(node, 'Color', -1)) || 'none';
  const shape = doc.str(node, 'Shape', 'skRectangle');
  const curve = doc.num(node, 'Curve', 0) || 10;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

  let figure;
  const inset = strokeWidth / 2;
  if (shape === 'skEllipse') {
    figure = document.createElementNS(SVG_NS, 'ellipse');
    figure.setAttribute('cx', String(w / 2));
    figure.setAttribute('cy', String(h / 2));
    figure.setAttribute('rx', String(Math.max(0, w / 2 - inset)));
    figure.setAttribute('ry', String(Math.max(0, h / 2 - inset)));
  } else if (shape === 'skTriangle') {
    figure = document.createElementNS(SVG_NS, 'polygon');
    figure.setAttribute('points', `${w / 2},${inset} ${w - inset},${h - inset} ${inset},${h - inset}`);
  } else if (shape === 'skDiamond') {
    figure = document.createElementNS(SVG_NS, 'polygon');
    figure.setAttribute('points', `${w / 2},${inset} ${w - inset},${h / 2} ${w / 2},${h - inset} ${inset},${h / 2}`);
  } else {
    figure = document.createElementNS(SVG_NS, 'rect');
    figure.setAttribute('x', String(inset));
    figure.setAttribute('y', String(inset));
    figure.setAttribute('width', String(Math.max(0, w - strokeWidth)));
    figure.setAttribute('height', String(Math.max(0, h - strokeWidth)));
    if (shape === 'skRoundRectangle') {
      figure.setAttribute('rx', String(curve));
      figure.setAttribute('ry', String(curve));
    }
  }
  figure.setAttribute('fill', fill);
  figure.setAttribute('stroke', stroke);
  figure.setAttribute('stroke-width', String(strokeWidth));
  svg.appendChild(figure);
  el.appendChild(svg);
  if (!doc.bool(node, 'Visible', true)) el.classList.add('fr-hidden');
  return el;
}

function renderPicture(doc, node) {
  const el = document.createElement('div');
  el.className = 'fr-obj fr-picture';
  applyRect(el, doc, node);
  applyFrame(el, doc, node);

  let url = pictureCache.get(node);
  if (url === undefined) {
    url = propDataToDataUrl(doc.str(node, 'Picture.PropData', ''));
    pictureCache.set(node, url);
  }
  if (url) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = doc.str(node, 'Name', 'imagem');
    img.draggable = false;
    const keepAspect = doc.bool(node, 'KeepAspectRatio', true);
    const stretched = doc.bool(node, 'Stretched', true);
    img.style.objectFit = !stretched ? 'none' : keepAspect ? 'contain' : 'fill';
    el.appendChild(img);
  } else {
    el.classList.add('fr-placeholder');
    el.textContent = 'imagem';
  }
  if (!doc.bool(node, 'Visible', true)) el.classList.add('fr-hidden');
  return el;
}

function renderGeneric(doc, node, options) {
  const el = document.createElement('div');
  el.className = 'fr-obj fr-generic';
  applyRect(el, doc, node);
  applyFrame(el, doc, node);
  applyFill(el, doc, node);
  const label = document.createElement('span');
  const text = doc.str(node, 'Text', '');
  label.textContent = text
    ? (options.resolve ? resolveText(text, options.values, options) : text)
    : node.name.replace(/^Tfrx|View$/g, '');
  el.appendChild(label);
  if (!doc.bool(node, 'Visible', true)) el.classList.add('fr-hidden');
  return el;
}

/** Cria o elemento DOM de um objeto FR3. */
export function renderObject(doc, node, options = {}) {
  switch (node.name) {
    case 'TfrxMemoView':
      return renderMemo(doc, node, options);
    case 'TfrxLineView':
      return renderLine(doc, node);
    case 'TfrxShapeView':
    case 'TfrxRoundRectView':
      return renderShape(doc, node);
    case 'TfrxPictureView':
      return renderPicture(doc, node);
    default:
      return renderGeneric(doc, node, options);
  }
}

/** Invalida o cache de imagem de um objeto (apos trocar a figura). */
export function invalidatePicture(node) {
  pictureCache.delete(node);
}
