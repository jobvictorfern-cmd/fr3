/**
 * Area de edicao: desenha a pagina, as bandas e os objetos e trata as
 * interacoes de mouse (selecao, arraste, redimensionamento, marquee, edicao de
 * texto no local).
 */

import { renderObject } from '../core/render.js';
import { isBand, BAND_LABELS, OBJECT_LABELS } from '../core/fr3.js';
import { pxToMm, mmToPx } from '../core/units.js';

const HANDLES = [
  ['nw', 0, 0, 'nwse-resize'],
  ['n', 0.5, 0, 'ns-resize'],
  ['ne', 1, 0, 'nesw-resize'],
  ['e', 1, 0.5, 'ew-resize'],
  ['se', 1, 1, 'nwse-resize'],
  ['s', 0.5, 1, 'ns-resize'],
  ['sw', 0, 1, 'nesw-resize'],
  ['w', 0, 0.5, 'ew-resize'],
];

export function createCanvas(store, elements) {
  const { canvas, scroll, rulerH, rulerV, status } = elements;
  /** @type {Map<object, HTMLElement>} no FR3 -> elemento DOM */
  let nodeElements = new Map();
  let workArea = null;
  let pageElement = null;
  let editing = null;

  scroll.addEventListener('scroll', syncRulers);
  scroll.addEventListener('pointermove', reportPointer);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('dblclick', onDoubleClick);

  function render() {
    commitInlineEdit();
    canvas.textContent = '';
    nodeElements = new Map();
    workArea = null;
    pageElement = null;

    const doc = store.doc;
    const page = store.page;
    if (!doc || !page) return;

    const geo = doc.pageGeometry(page);
    canvas.style.width = geo.width * store.zoom + 'px';
    canvas.style.height = geo.height * store.zoom + 'px';

    pageElement = document.createElement('div');
    pageElement.className = 'page design';
    pageElement.style.width = geo.width + 'px';
    pageElement.style.height = geo.height + 'px';
    pageElement.style.transform = `scale(${store.zoom})`;
    pageElement.style.transformOrigin = '0 0';
    canvas.appendChild(pageElement);

    if (store.showGrid) {
      const grid = document.createElement('div');
      grid.className = 'page-grid';
      const step = mmToPx(5);
      grid.style.backgroundImage =
        'linear-gradient(to right, rgba(120,132,158,.16) 1px, transparent 1px),' +
        'linear-gradient(to bottom, rgba(120,132,158,.16) 1px, transparent 1px)';
      grid.style.backgroundSize = `${step}px ${step}px`;
      grid.style.backgroundPosition = `${geo.left}px ${geo.top}px`;
      pageElement.appendChild(grid);
    }

    const margins = document.createElement('div');
    margins.className = 'page-margins';
    margins.style.left = geo.left + 'px';
    margins.style.top = geo.top + 'px';
    margins.style.width = geo.width - geo.left - geo.right + 'px';
    margins.style.height = geo.height - geo.top - geo.bottom + 'px';
    pageElement.appendChild(margins);

    workArea = document.createElement('div');
    workArea.className = 'page-work';
    workArea.style.position = 'absolute';
    workArea.style.left = geo.left + 'px';
    workArea.style.top = geo.top + 'px';
    workArea.style.width = geo.width - geo.left - geo.right + 'px';
    workArea.style.height = geo.height - geo.top - geo.bottom + 'px';
    workArea.__node = page;
    pageElement.appendChild(workArea);

    for (const band of doc.orderedBands(page)) {
      workArea.appendChild(buildBand(doc, band));
    }
    // Objetos soltos, ancorados direto na pagina.
    for (const object of doc.objectsOf(page)) {
      workArea.appendChild(buildObject(doc, object));
    }

    drawHandles();
    syncRulers();
    drawRulerTicks(geo);
  }

  function buildBand(doc, band) {
    const el = document.createElement('div');
    el.className = 'band';
    el.style.left = doc.num(band, 'Left') + 'px';
    el.style.top = doc.num(band, 'Top') + 'px';
    el.style.width = doc.num(band, 'Width') + 'px';
    el.style.height = doc.num(band, 'Height') + 'px';
    el.__node = band;
    if (store.isSelected(band)) el.classList.add('selected');

    const caption = document.createElement('div');
    caption.className = 'band-caption';
    caption.textContent = `${BAND_LABELS[band.name] || band.name} · ${doc.str(band, 'Name')} · ${fmt(doc.num(band, 'Height'))}`;
    caption.__node = band;
    // A legenda e as alcas nao devem crescer junto com o zoom.
    caption.style.transform = `scale(${1 / store.zoom})`;
    caption.style.transformOrigin = '0 100%';
    el.appendChild(caption);

    const grip = document.createElement('div');
    grip.className = 'band-resize';
    grip.dataset.bandResize = '1';
    grip.__node = band;
    el.appendChild(grip);

    for (const object of doc.objectsOf(band)) {
      el.appendChild(buildObject(doc, object));
    }
    nodeElements.set(band, el);
    return el;
  }

  function buildObject(doc, object) {
    const el = renderObject(doc, object, { resolve: false });
    el.__node = object;
    el.title = `${OBJECT_LABELS[object.name] || object.name}: ${doc.str(object, 'Name')}`;
    if (store.isSelected(object)) el.classList.add('selected');
    nodeElements.set(object, el);
    return el;
  }

  function fmt(px) {
    return store.unit === 'mm' ? pxToMm(px).toFixed(1) + ' mm' : px.toFixed(0) + ' px';
  }

  /* ------------------------------- handles -------------------------------- */

  function drawHandles() {
    pageElement?.querySelectorAll('.handle').forEach((h) => h.remove());
    const targets = store.selection.filter((node) => nodeElements.has(node) && !isBand(node));
    if (targets.length !== 1) return;
    const node = targets[0];
    const el = nodeElements.get(node);
    const parent = el.parentElement;
    const rect = store.doc.rect(node);
    const size = 7 / store.zoom;
    for (const [name, fx, fy, cursor] of HANDLES) {
      const handle = document.createElement('div');
      handle.className = 'handle';
      handle.dataset.handle = name;
      handle.style.cursor = cursor;
      handle.style.width = size + 'px';
      handle.style.height = size + 'px';
      handle.style.left = rect.left + rect.width * fx - size / 2 + 'px';
      handle.style.top = rect.top + rect.height * fy - size / 2 + 'px';
      handle.__node = node;
      parent.appendChild(handle);
    }
  }

  /* ------------------------------ interacao ------------------------------- */

  function pagePoint(event) {
    const box = pageElement.getBoundingClientRect();
    return {
      x: (event.clientX - box.left) / store.zoom,
      y: (event.clientY - box.top) / store.zoom,
    };
  }

  function snap(value) {
    if (!store.snap) return value;
    const grid = store.gridPx || 1;
    return Math.round(value / grid) * grid;
  }

  function onPointerDown(event) {
    if (event.button !== 0 || !store.doc || !pageElement) return;
    if (editing && editing.element.contains(event.target)) return;
    commitInlineEdit();

    const target = event.target;
    const handle = target.closest?.('.handle');
    if (handle) return startResize(event, handle.__node, handle.dataset.handle);

    const grip = target.closest?.('[data-band-resize]');
    if (grip) return startBandResize(event, grip.__node);

    const objectEl = target.closest?.('.fr-obj');
    if (objectEl) {
      const node = objectEl.__node;
      const additive = event.shiftKey || event.ctrlKey || event.metaKey;
      if (!store.isSelected(node)) store.select(node, additive);
      else if (additive) store.select(node, true);
      if (store.isSelected(node)) startDrag(event);
      return;
    }

    const caption = target.closest?.('.band-caption');
    if (caption) {
      store.select(caption.__node, event.shiftKey);
      return;
    }

    const bandEl = target.closest?.('.band');
    if (bandEl) {
      store.select(bandEl.__node);
      startMarquee(event, bandEl);
      return;
    }

    store.select(store.page);
    if (workArea) startMarquee(event, workArea);
  }

  function startDrag(event) {
    const doc = store.doc;
    const nodes = store.selection.filter((node) => nodeElements.has(node) && !isBand(node));
    if (!nodes.length) return;
    const start = pagePoint(event);
    const origins = nodes.map((node) => ({ node, rect: doc.rect(node), el: nodeElements.get(node) }));
    let moved = false;
    let delta = { x: 0, y: 0 };

    drag(event, (moveEvent) => {
      const point = pagePoint(moveEvent);
      let dx = point.x - start.x;
      let dy = point.y - start.y;
      if (moveEvent.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      const first = origins[0];
      if (store.snap && !moveEvent.altKey) {
        dx = snap(first.rect.left + dx) - first.rect.left;
        dy = snap(first.rect.top + dy) - first.rect.top;
      }
      delta = { x: dx, y: dy };
      moved = moved || Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5;
      for (const item of origins) {
        item.el.style.left = item.rect.left + dx + 'px';
        item.el.style.top = item.rect.top + dy + 'px';
      }
      showStatus(`Δ ${fmt(dx)} · ${fmt(dy)}`);
    }, (upEvent) => {
      if (!moved) return render();
      const dropTarget = containerAt(upEvent);
      store.mutate(() => {
        for (const item of origins) {
          const node = item.node;
          let top = item.rect.top + delta.y;
          let left = item.rect.left + delta.x;
          if (dropTarget && dropTarget !== node.parent) {
            const oldOffset = isBand(node.parent) ? doc.num(node.parent, 'Top') : 0;
            const newOffset = isBand(dropTarget) ? doc.num(dropTarget, 'Top') : 0;
            top = top + oldOffset - newOffset;
            doc.reparent(node, dropTarget);
          }
          doc.setRect(node, { left, top });
        }
      });
    });
  }

  /** Banda (ou pagina) sob o ponteiro, usada como destino do arraste. */
  function containerAt(event) {
    const stack = document.elementsFromPoint(event.clientX, event.clientY);
    for (const el of stack) {
      if (el.classList?.contains('band')) return el.__node;
      if (el === workArea) return workArea.__node;
    }
    return null;
  }

  function startResize(event, node, handleName) {
    const doc = store.doc;
    const el = nodeElements.get(node);
    const start = pagePoint(event);
    const origin = doc.rect(node);
    let rect = { ...origin };

    drag(event, (moveEvent) => {
      const point = pagePoint(moveEvent);
      const dx = point.x - start.x;
      const dy = point.y - start.y;
      rect = { ...origin };
      if (handleName.includes('e')) rect.width = Math.max(1, snap(origin.left + origin.width + dx) - origin.left);
      if (handleName.includes('s')) rect.height = Math.max(0, snap(origin.top + origin.height + dy) - origin.top);
      if (handleName.includes('w')) {
        const left = snap(origin.left + dx);
        rect.width = Math.max(1, origin.left + origin.width - left);
        rect.left = left;
      }
      if (handleName.includes('n')) {
        const top = snap(origin.top + dy);
        rect.height = Math.max(0, origin.top + origin.height - top);
        rect.top = top;
      }
      Object.assign(el.style, {
        left: rect.left + 'px',
        top: rect.top + 'px',
        width: rect.width + 'px',
        height: rect.height + 'px',
      });
      showStatus(`${fmt(rect.width)} × ${fmt(rect.height)}`);
    }, () => {
      store.mutate(() => doc.setRect(node, rect));
    });
  }

  function startBandResize(event, band) {
    const doc = store.doc;
    const el = nodeElements.get(band);
    const start = pagePoint(event);
    const origin = doc.num(band, 'Height');
    let height = origin;

    drag(event, (moveEvent) => {
      const point = pagePoint(moveEvent);
      height = Math.max(0, snap(origin + point.y - start.y));
      el.style.height = height + 'px';
      showStatus(`Altura da banda: ${fmt(height)}`);
    }, () => {
      store.mutate(() => doc.resizeBand(band, height));
    });
  }

  function startMarquee(event, container) {
    const start = pagePoint(event);
    const box = document.createElement('div');
    box.className = 'marquee';
    pageElement.appendChild(box);
    let area = null;

    drag(event, (moveEvent) => {
      const point = pagePoint(moveEvent);
      area = {
        left: Math.min(start.x, point.x),
        top: Math.min(start.y, point.y),
        right: Math.max(start.x, point.x),
        bottom: Math.max(start.y, point.y),
      };
      box.style.left = area.left + 'px';
      box.style.top = area.top + 'px';
      box.style.width = area.right - area.left + 'px';
      box.style.height = area.bottom - area.top + 'px';
    }, (upEvent) => {
      box.remove();
      if (!area || (area.right - area.left < 3 && area.bottom - area.top < 3)) return;
      const pageBox = pageElement.getBoundingClientRect();
      const hits = [];
      for (const [node, el] of nodeElements) {
        if (isBand(node)) continue;
        const box2 = el.getBoundingClientRect();
        const left = (box2.left - pageBox.left) / store.zoom;
        const top = (box2.top - pageBox.top) / store.zoom;
        const right = left + box2.width / store.zoom;
        const bottom = top + box2.height / store.zoom;
        if (right >= area.left && left <= area.right && bottom >= area.top && top <= area.bottom) {
          hits.push(node);
        }
      }
      store.select(hits, upEvent.shiftKey);
    });
  }

  function drag(event, onMove, onUp) {
    event.preventDefault();
    const move = (e) => onMove(e);
    const up = (e) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      onUp?.(e);
      showStatus('');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /* --------------------------- edicao de texto ---------------------------- */

  function onDoubleClick(event) {
    const objectEl = event.target.closest?.('.fr-obj.fr-memo');
    if (!objectEl) return;
    const node = objectEl.__node;
    const textEl = objectEl.querySelector('.fr-memo-text');
    if (!textEl) return;
    objectEl.classList.add('editing');
    textEl.contentEditable = 'true';
    textEl.style.whiteSpace = 'pre-wrap';
    textEl.focus();
    document.getSelection()?.selectAllChildren(textEl);
    editing = { node, element: objectEl, textEl };
    textEl.addEventListener('keydown', onEditKeyDown);
    textEl.addEventListener('blur', commitInlineEdit, { once: true });
  }

  function onEditKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelInlineEdit();
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      commitInlineEdit();
    }
    event.stopPropagation();
  }

  function readEditedText(textEl) {
    return textEl.innerText.replace(/\r\n|\r|\n/g, '\r\n').replace(/\u00a0/g, ' ');
    // que e o que o FastReport grava.
    return textEl.innerText.replace(/\r\n|\r|\n/g, '\r\n').replace(/ /g, ' ');
  }

  function commitInlineEdit() {
    if (!editing) return;
    const { node, textEl } = editing;
    const value = readEditedText(textEl);
    editing = null;
    textEl.removeEventListener('keydown', onEditKeyDown);
    textEl.contentEditable = 'false';
    if (value !== store.doc.str(node, 'Text', '')) {
      store.mutate(() => store.doc.setStr(node, 'Text', value));
    } else {
      render();
    }
  }

  function cancelInlineEdit() {
    if (!editing) return;
    const { textEl } = editing;
    editing = null;
    textEl.removeEventListener('keydown', onEditKeyDown);
    textEl.contentEditable = 'false';
    render();
  }

  /* -------------------------------- reguas -------------------------------- */

  function drawRulerTicks(geo) {
    rulerH.textContent = '';
    rulerV.textContent = '';
    const stepMm = store.zoom < 0.6 ? 20 : store.zoom < 1.2 ? 10 : 5;
    const originX = geo.left;
    const originY = geo.top;

    for (let mm = -Math.floor(pxToMm(originX) / stepMm) * stepMm; mmToPx(mm) + originX <= geo.width; mm += stepMm) {
      const x = (originX + mmToPx(mm)) * store.zoom;
      const tick = document.createElement('div');
      tick.className = 'tick major';
      tick.style.left = x + 'px';
      rulerH.appendChild(tick);
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = String(mm);
      label.style.left = x + 'px';
      rulerH.appendChild(label);
    }

    for (let mm = -Math.floor(pxToMm(originY) / stepMm) * stepMm; mmToPx(mm) + originY <= geo.height; mm += stepMm) {
      const y = (originY + mmToPx(mm)) * store.zoom;
      const tick = document.createElement('div');
      tick.className = 'tick major';
      tick.style.top = y + 'px';
      rulerV.appendChild(tick);
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = String(mm);
      label.style.top = y + 'px';
      rulerV.appendChild(label);
    }
    syncRulers();
  }

  function syncRulers() {
    const offsetX = 24 - scroll.scrollLeft;
    const offsetY = 24 - scroll.scrollTop;
    for (const child of rulerH.children) child.style.transform = `translateX(${offsetX}px)`;
    for (const child of rulerV.children) child.style.transform = `translateY(${offsetY}px)`;
  }

  function reportPointer(event) {
    if (!pageElement || !store.doc) return;
    const geo = store.doc.pageGeometry(store.page);
    const point = pagePoint(event);
    const x = point.x - geo.left;
    const y = point.y - geo.top;
    status.pointer.textContent = store.unit === 'mm'
      ? `${pxToMm(x).toFixed(1)} ; ${pxToMm(y).toFixed(1)} mm`
      : `${x.toFixed(0)} ; ${y.toFixed(0)} px`;
  }

  function showStatus(text) {
    status.hint.textContent = text;
  }

  /** Zoom que faz a pagina caber na area visivel. */
  function fitZoom() {
    if (!store.doc || !store.page) return 1;
    const geo = store.doc.pageGeometry(store.page);
    const byWidth = (scroll.clientWidth - 60) / geo.width;
    const byHeight = (scroll.clientHeight - 60) / geo.height;
    return Math.max(0.1, Math.min(3, Math.min(byWidth, byHeight)));
  }

  return { render, fitZoom, commitInlineEdit };
}
