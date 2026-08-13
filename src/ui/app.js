/**
 * Ponto de entrada: liga o estado, a area de edicao, a arvore, o inspetor, o
 * painel de dados e a pre-visualizacao, e trata a barra de ferramentas, os
 * atalhos de teclado e a leitura/gravacao dos arquivos.
 */

import { store } from './store.js';
import { createCanvas } from './canvas.js';
import { createTree } from './tree.js';
import { createInspector } from './inspector.js';
import { createDataPanel } from './datapanel.js';
import { createPreview } from './preview.js';
import { isBand, isPage, BAND_LABELS, BAND_TAGS } from '../core/fr3.js';
import { parseDocument, serialize, cloneNode, childElements } from '../core/xml.js';
import { pxToMm } from '../core/units.js';

const $ = (id) => document.getElementById(id);

const status = {
  file: $('statusFile'),
  selection: $('statusSelection'),
  pointer: $('statusPointer'),
  hint: $('statusHint'),
};

const canvas = createCanvas(store, {
  canvas: $('canvas'),
  scroll: $('canvasScroll'),
  rulerH: $('rulerH'),
  rulerV: $('rulerV'),
  status,
});
const tree = createTree(store, $('tree'));
const inspector = createInspector(store, $('inspector'), $('inspectorTitle'));
const dataPanel = createDataPanel(store, $('dataPanel'));
const preview = createPreview(store, {
  root: $('preview'),
  body: $('previewBody'),
  info: $('previewInfo'),
});

/** @type {string[]} objetos copiados, guardados como XML */
let clipboard = [];

/* ------------------------------- renderizacao ------------------------------ */

store.on((what) => {
  if (what === 'doc' || what === 'view') {
    canvas.render();
    tree.render();
    dataPanel.render();
    inspector.render();
    if (preview.isOpen) preview.render();
  } else if (what === 'selection') {
    canvas.render();
    tree.render();
    tree.revealSelection();
    inspector.render();
  } else if (what === 'values') {
    if (preview.isOpen) preview.render();
  }
  updateStatus();
  updateToolbar();
});

function updateStatus() {
  status.file.textContent = store.doc
    ? `${store.fileName}${store.dirty ? ' •' : ''}`
    : 'Nenhum arquivo aberto';

  const selection = store.selection;
  if (!store.doc || !selection.length) {
    status.selection.textContent = store.doc ? 'Nada selecionado' : '';
    return;
  }
  if (selection.length > 1) {
    status.selection.textContent = `${selection.length} objetos selecionados`;
    return;
  }
  const node = selection[0];
  const name = store.doc.str(node, 'Name', node.name);
  if (isPage(node)) {
    const geo = store.doc.pageGeometry(node);
    status.selection.textContent = `${name} · ${geo.paperWidth} × ${geo.paperHeight} mm`;
    return;
  }
  const rect = store.doc.rect(node);
  const unit = (px) => (store.unit === 'mm' ? `${pxToMm(px).toFixed(1)}` : `${Math.round(px)}`);
  status.selection.textContent =
    `${name} · ${unit(rect.left)} ; ${unit(rect.top)} · ${unit(rect.width)} × ${unit(rect.height)} ${store.unit}`;
}

function updateToolbar() {
  $('btnUndo').disabled = !store.canUndo;
  $('btnRedo').disabled = !store.canRedo;
  $('btnSave').disabled = !store.doc;
  $('zoomValue').textContent = Math.round(store.zoom * 100) + '%';
}

/* --------------------------------- arquivos -------------------------------- */

async function loadFromFile(file) {
  const text = await file.text();
  try {
    store.load(text, file.name);
    fitZoom();
  } catch (error) {
    alert(`Nao foi possivel abrir "${file.name}":\n${error.message}`);
  }
}

function save() {
  if (!store.doc) return;
  const text = store.doc.serialize();
  const blob = new Blob([text], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = store.fileName.replace(/\.(fr3|term|xml)$/i, '') + '.fr3';
  link.click();
  URL.revokeObjectURL(url);
  store.dirty = false;
  updateStatus();
}

async function loadSample() {
  try {
    const response = await fetch('samples/rsiamac_1.fr3');
    if (!response.ok) throw new Error(String(response.status));
    store.load(await response.text(), 'rsiamac_1.fr3');
    fitZoom();
  } catch {
    store.newDocument();
    fitZoom();
  }
}

/* --------------------------------- edicao ---------------------------------- */

/** Banda onde novos objetos devem entrar (a selecionada ou a primeira). */
function targetContainer() {
  const doc = store.doc;
  const page = store.page;
  for (const node of store.selection) {
    if (isBand(node)) return node;
    if (node.parent && (isBand(node.parent) || isPage(node.parent))) return node.parent;
  }
  return doc.orderedBands(page)[0] || page;
}

function insertObject(tag) {
  if (!store.doc) return;
  const parent = targetContainer();
  store.mutate(() => {
    const node = store.doc.addObject(parent, tag);
    store.selection = [node];
  });
}

function addBand(tag) {
  store.mutate(() => {
    const band = store.doc.addBand(store.page, tag);
    store.selection = [band];
  });
}

function selectedObjects() {
  return store.selection.filter((node) => !isBand(node) && !isPage(node));
}

function nudge(dx, dy) {
  const objects = selectedObjects();
  if (!objects.length) return;
  store.mutate(() => {
    for (const node of objects) {
      store.doc.setNum(node, 'Left', store.doc.num(node, 'Left') + dx);
      store.doc.setNum(node, 'Top', store.doc.num(node, 'Top') + dy);
    }
  });
}

function align(kind) {
  const doc = store.doc;
  const objects = selectedObjects();
  if (!objects.length) return;
  const rects = objects.map((node) => doc.rect(node));

  store.mutate(() => {
    if (kind === 'center-page') {
      for (const [index, node] of objects.entries()) {
        const parent = node.parent;
        const width = isBand(parent) ? doc.num(parent, 'Width') : doc.contentWidth(store.page);
        doc.setNum(node, 'Left', (width - rects[index].width) / 2);
      }
      return;
    }
    if (objects.length < 2) return;
    const left = Math.min(...rects.map((r) => r.left));
    const right = Math.max(...rects.map((r) => r.left + r.width));
    const top = Math.min(...rects.map((r) => r.top));
    const bottom = Math.max(...rects.map((r) => r.top + r.height));

    for (const [index, node] of objects.entries()) {
      const rect = rects[index];
      switch (kind) {
        case 'left': doc.setNum(node, 'Left', left); break;
        case 'right': doc.setNum(node, 'Left', right - rect.width); break;
        case 'hcenter': doc.setNum(node, 'Left', (left + right) / 2 - rect.width / 2); break;
        case 'top': doc.setNum(node, 'Top', top); break;
        case 'bottom': doc.setNum(node, 'Top', bottom - rect.height); break;
        case 'vcenter': doc.setNum(node, 'Top', (top + bottom) / 2 - rect.height / 2); break;
        case 'width': doc.setNum(node, 'Width', rects[0].width); break;
        case 'height': doc.setNum(node, 'Height', rects[0].height); break;
      }
    }
  });
}

function copySelection() {
  const objects = selectedObjects();
  if (!objects.length) return;
  clipboard = objects.map((node) => serialize(node));
}

function pasteClipboard() {
  if (!clipboard.length || !store.doc) return;
  const parent = targetContainer();
  store.mutate(() => {
    const created = [];
    for (const xml of clipboard) {
      const parsed = childElements(parseDocument(xml))[0];
      if (!parsed) continue;
      const node = cloneNode(parsed);
      store.doc.setNum(node, 'Left', store.doc.num(node, 'Left') + 9.44882);
      store.doc.setNum(node, 'Top', store.doc.num(node, 'Top') + 9.44882);
      store.doc.insertObjectNode(parent, node);
      created.push(node);
    }
    store.selection = created;
  });
}

function deleteSelection() {
  const nodes = store.selection.filter((node) => !isPage(node));
  if (!nodes.length) return;
  store.mutate(() => {
    for (const node of nodes) store.doc.remove(node);
    store.selection = [];
  });
}

/* ---------------------------------- zoom ----------------------------------- */

function setZoom(zoom) {
  store.setView({ zoom: Math.min(4, Math.max(0.1, zoom)) });
}

function fitZoom() {
  setZoom(canvas.fitZoom());
}

/* ------------------------------- interface --------------------------------- */

function bindToolbar() {
  $('btnNew').addEventListener('click', () => {
    if (store.dirty && !confirm('Descartar as alteracoes nao salvas?')) return;
    store.newDocument();
    fitZoom();
  });
  $('btnOpen').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (file) loadFromFile(file);
    event.target.value = '';
  });
  $('btnSave').addEventListener('click', save);
  $('btnUndo').addEventListener('click', () => store.undo());
  $('btnRedo').addEventListener('click', () => store.redo());

  for (const button of document.querySelectorAll('[data-insert]')) {
    button.addEventListener('click', () => insertObject(button.dataset.insert));
  }
  for (const button of document.querySelectorAll('[data-align]')) {
    button.addEventListener('click', () => align(button.dataset.align));
  }
  $('btnAddBand').addEventListener('click', (event) => openBandMenu(event.currentTarget));

  $('btnZoomIn').addEventListener('click', () => setZoom(store.zoom * 1.25));
  $('btnZoomOut').addEventListener('click', () => setZoom(store.zoom / 1.25));
  $('btnZoomFit').addEventListener('click', fitZoom);

  $('chkGrid').addEventListener('change', (e) => store.setView({ showGrid: e.target.checked }));
  $('chkSnap').addEventListener('change', (e) => store.setView({ snap: e.target.checked }));
  $('selUnit').addEventListener('change', (e) => store.setView({ unit: e.target.value }));

  $('btnPreview').addEventListener('click', () => preview.toggle());
  $('btnPreviewClose').addEventListener('click', () => preview.close());
  $('btnPreviewPrint').addEventListener('click', () => window.print());

  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.tab-panel').forEach((panel) => {
        panel.classList.toggle('active', panel.dataset.panel === tab.dataset.tab);
      });
    });
  }
}

/** Menu simples para escolher o tipo de banda a inserir. */
function openBandMenu(anchor) {
  document.querySelector('.band-menu')?.remove();
  const menu = document.createElement('div');
  menu.className = 'band-menu';
  Object.assign(menu.style, {
    position: 'fixed',
    zIndex: '300',
    background: '#fff',
    border: '1px solid #d3d7de',
    borderRadius: '4px',
    boxShadow: '0 6px 18px rgba(0,0,0,.25)',
    padding: '4px',
    maxHeight: '60vh',
    overflow: 'auto',
  });
  const box = anchor.getBoundingClientRect();
  menu.style.left = box.left + 'px';
  menu.style.top = box.bottom + 4 + 'px';

  for (const tag of BAND_TAGS) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'mini-btn';
    item.style.display = 'block';
    item.style.width = '100%';
    item.style.textAlign = 'left';
    item.style.border = '0';
    item.textContent = BAND_LABELS[tag] || tag;
    item.addEventListener('click', () => {
      menu.remove();
      addBand(tag);
    });
    menu.appendChild(item);
  }
  document.body.appendChild(menu);
  setTimeout(() => {
    const close = (event) => {
      if (!menu.contains(event.target)) {
        menu.remove();
        document.removeEventListener('pointerdown', close);
      }
    };
    document.addEventListener('pointerdown', close);
  });
}

function bindShortcuts() {
  document.addEventListener('keydown', (event) => {
    const target = event.target;
    const typing = target.matches?.('input, textarea, select, [contenteditable="true"]');
    const ctrl = event.ctrlKey || event.metaKey;

    if (event.key === 'Escape' && preview.isOpen) {
      preview.close();
      return;
    }
    if (event.key === 'F5') {
      event.preventDefault();
      preview.toggle();
      return;
    }
    if (ctrl && event.key.toLowerCase() === 's') {
      event.preventDefault();
      save();
      return;
    }
    if (ctrl && event.key.toLowerCase() === 'o') {
      event.preventDefault();
      $('fileInput').click();
      return;
    }
    if (typing) return;

    if (ctrl && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      event.shiftKey ? store.redo() : store.undo();
      return;
    }
    if (ctrl && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      store.redo();
      return;
    }
    if (ctrl && event.key.toLowerCase() === 'c') { copySelection(); return; }
    if (ctrl && event.key.toLowerCase() === 'v') { event.preventDefault(); pasteClipboard(); return; }
    if (ctrl && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      const objects = selectedObjects();
      if (objects.length) {
        store.mutate(() => {
          store.selection = objects.map((node) => store.doc.duplicate(node));
        });
      }
      return;
    }
    if (ctrl && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      const parent = targetContainer();
      store.select(store.doc.objectsOf(parent));
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      deleteSelection();
      return;
    }
    if (event.key.startsWith('Arrow')) {
      event.preventDefault();
      const step = event.shiftKey ? store.gridPx * 10 : event.altKey ? 1 : store.gridPx;
      const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
      const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
      nudge(dx, dy);
    }
  });
}

function bindDropZone() {
  const hint = $('dropHint');
  let depth = 0;
  window.addEventListener('dragenter', (event) => {
    event.preventDefault();
    depth++;
    hint.hidden = false;
  });
  window.addEventListener('dragover', (event) => event.preventDefault());
  window.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) hint.hidden = true;
  });
  window.addEventListener('drop', (event) => {
    event.preventDefault();
    depth = 0;
    hint.hidden = true;
    const file = event.dataTransfer?.files?.[0];
    if (file) loadFromFile(file);
  });
}

function bindUnload() {
  window.addEventListener('beforeunload', (event) => {
    if (!store.dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });
}

bindToolbar();
bindShortcuts();
bindDropZone();
bindUnload();
loadSample();

// Exposto para depuracao no console do navegador.
window.fr3 = { store, canvas, preview };
