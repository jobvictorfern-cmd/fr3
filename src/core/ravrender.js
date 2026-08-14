/**
 * Desenho das paginas de um projeto Rave (.rav).
 *
 * O Rave grava tudo em polegadas; a tela usa 96 px por polegada, como no
 * editor de .fr3. A renderizacao e uma aproximacao util para posicionar
 * objetos — o resultado impresso continua sendo o do Rave.
 */

const PX_PER_INCH = 96;

export const inchToPx = (value) => value * PX_PER_INCH;

import { CONTAINER_CLASSES as CONTAINERS } from './rav.js';

/** Alinhamento horizontal do Rave -> CSS. */
const JUSTIFY = {
  pjLeft: 'left',
  pjCenter: 'center',
  pjRight: 'right',
  pjBlock: 'justify',
};

function applyRect(el, rect) {
  el.style.left = inchToPx(rect.left) + 'px';
  el.style.top = inchToPx(rect.top) + 'px';
  el.style.width = inchToPx(rect.width) + 'px';
  el.style.height = inchToPx(rect.height) + 'px';
}

function textOf(doc, object) {
  const text = doc.property(object, 'Text');
  if (text && text.value) return String(text.value);
  const field = doc.property(object, 'DataField');
  if (field && field.value) return `[${field.value}]`;
  return '';
}

function renderText(doc, object, rect) {
  const el = document.createElement('div');
  el.className = 'rav-obj rav-obj-text';
  applyRect(el, rect);

  const font = doc.fontOf(object);
  const fontPx = (font.size * 96) / 72;
  // Altura 0 no Rave significa "do tamanho do texto": sem isso o objeto ficaria
  // invisivel e sem area de clique na tela.
  if (inchToPx(rect.height) < fontPx) el.style.height = fontPx * 1.25 + 'px';
  el.style.fontFamily = `"${font.name}", Arial, sans-serif`;
  el.style.fontSize = fontPx + 'px';
  el.style.fontWeight = font.bold ? '700' : '400';
  el.style.fontStyle = font.italic ? 'italic' : 'normal';
  el.style.textDecoration = font.underline ? 'underline' : 'none';
  el.style.color = doc.colorOf(object, 'Color', '#000') || '#000';
  el.style.textAlign = JUSTIFY[doc.property(object, 'FontJustify')?.value] || 'left';
  if (object.className === 'TRaveMemo' || object.className === 'TRaveDataMemo') {
    el.style.whiteSpace = 'pre-wrap';
  }
  el.textContent = textOf(doc, object);
  if (object.className.includes('Data')) el.classList.add('rav-obj-data');
  return el;
}

function renderLine(doc, object, rect, horizontal) {
  const el = document.createElement('div');
  el.className = 'rav-obj rav-obj-line';
  applyRect(el, rect);
  const color = doc.colorOf(object, 'Color', '#000') || '#000';
  const width = Math.max(1, Number(doc.property(object, 'LineWidth')?.value) || 1);
  if (horizontal) {
    el.style.borderTop = `${width}px solid ${color}`;
    el.style.height = Math.max(inchToPx(rect.height), width) + 'px';
  } else {
    el.style.borderLeft = `${width}px solid ${color}`;
    el.style.width = Math.max(inchToPx(rect.width), width) + 'px';
  }
  return el;
}

function renderRectangle(doc, object, rect) {
  const el = document.createElement('div');
  el.className = 'rav-obj rav-obj-rect';
  applyRect(el, rect);
  const border = doc.colorOf(object, 'BorderColor', '#000') || '#000';
  const width = Math.max(1, Number(doc.property(object, 'BorderWidth')?.value) || 1);
  el.style.border = `${width}px solid ${border}`;
  const fillStyle = doc.property(object, 'FillStyle')?.value;
  const fill = doc.colorOf(object, 'FillColor', null);
  el.style.background = fillStyle === 'fsSolid' && fill ? fill : 'transparent';
  const radius = Number(doc.property(object, 'HRadius')?.value) || 0;
  if (radius) el.style.borderRadius = inchToPx(radius) + 'px';
  return el;
}

function renderContainer(doc, object, rect) {
  const el = document.createElement('div');
  el.className = 'rav-obj rav-obj-container';
  el.style.overflow = 'visible';
  applyRect(el, rect);
  const label = document.createElement('span');
  label.className = 'rav-obj-label';
  label.textContent = object.name;
  el.appendChild(label);
  return el;
}

function renderBitmap(doc, object, rect) {
  const el = document.createElement('div');
  el.className = 'rav-obj rav-obj-bitmap';
  applyRect(el, rect);
  el.textContent = 'imagem';
  return el;
}

function renderGeneric(doc, object, rect) {
  const el = document.createElement('div');
  el.className = 'rav-obj rav-obj-generic';
  applyRect(el, rect);
  el.textContent = object.className.replace(/^TRave/, '');
  return el;
}

/** Cria o elemento de um objeto Rave, ou null se ele nao tiver geometria. */
export function renderRavObject(doc, object) {
  const rect = doc.rect(object);
  if (!rect) return null;

  let el;
  switch (object.className) {
    case 'TRaveText':
    case 'TRaveMemo':
    case 'TRaveDataText':
    case 'TRaveDataMemo':
      el = renderText(doc, object, rect);
      break;
    case 'TRaveHLine':
      el = renderLine(doc, object, rect, true);
      break;
    case 'TRaveVLine':
      el = renderLine(doc, object, rect, false);
      break;
    case 'TRaveLine':
      el = renderLine(doc, object, rect, rect.width >= rect.height);
      break;
    case 'TRaveRectangle':
    case 'TRaveSquare':
      el = renderRectangle(doc, object, rect);
      break;
    case 'TRaveBitmap':
    case 'TRaveMetaFile':
      el = renderBitmap(doc, object, rect);
      break;
    default:
      el = CONTAINERS.has(object.className)
        ? renderContainer(doc, object, rect)
        : renderGeneric(doc, object, rect);
  }

  if (doc.property(object, 'Visible')?.value === 'False') el.classList.add('rav-hidden');
  return el;
}

/**
 * Desenha a arvore de uma pagina. Os filhos entram dentro do elemento do
 * container, entao o posicionamento relativo do Rave sai correto sem conta
 * nenhuma: e o mesmo que o CSS faz com `position: absolute`.
 * @returns {HTMLElement[]} elementos de primeiro nivel
 */
export function renderRavTree(doc, nodes, onElement) {
  const elements = [];
  for (const node of nodes) {
    const el = renderRavObject(doc, node.object);
    if (!el) continue;
    onElement?.(el, node.object);
    for (const child of node.children) {
      const childEl = renderRavObject(doc, child.object);
      if (!childEl) continue;
      onElement?.(childEl, child.object);
      el.appendChild(childEl);
    }
    elements.push(el);
  }
  return elements;
}

/** Quantos objetos da pagina aparecem no desenho. */
export function drawableCount(doc, page) {
  return doc.pageTree(page).reduce((total, node) => total + 1 + node.children.length, 0);
}
