/**
 * Estado da aplicacao: documento aberto, selecao, opcoes de visualizacao e
 * historico de desfazer/refazer.
 *
 * O historico guarda snapshots do XML inteiro. Um .fr3 tipico tem algumas
 * centenas de KB, entao 60 niveis custam pouca memoria e a implementacao fica
 * imune a bugs de "undo parcial".
 */

import { Fr3Document } from '../core/fr3.js';
import { RavDocument, isRavFile } from '../core/rav.js';
import { mmToPx } from '../core/units.js';
import { getAttr } from '../core/xml.js';

const HISTORY_LIMIT = 60;
const VALUES_KEY = 'fr3-editor:test-values';

export const store = {
  /** @type {Fr3Document|RavDocument|null} */
  doc: null,
  /** @type {'fr3'|'rav'|null} formato do documento aberto */
  kind: null,
  fileName: 'relatorio.fr3',
  /** caminho no disco (apenas no aplicativo desktop) */
  filePath: null,
  /** codificacao original do arquivo: 'utf8' ou 'windows1252' */
  encoding: 'utf8',
  pageIndex: 0,
  /** @type {Array<object>} nos selecionados (objetos, bandas ou a pagina) */
  selection: [],
  zoom: 1,
  unit: 'mm',
  gridPx: mmToPx(1),
  showGrid: true,
  snap: true,
  dirty: false,
  /** valores de teste usados na pre-visualizacao (nao vao para o arquivo) */
  values: loadValues(),

  _undo: [],
  _redo: [],
  _listeners: new Set(),

  /* ------------------------------- eventos -------------------------------- */

  on(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  },

  emit(what = 'doc') {
    for (const listener of this._listeners) listener(what, this);
  },

  /* ------------------------------ documento ------------------------------- */

  /**
   * Abre um documento. `data` e texto (.fr3) ou bytes (.rav); o formato e
   * decidido pelo conteudo, nao pela extensao.
   */
  load(data, fileName, meta = {}) {
    const bytes = data instanceof Uint8Array ? data : null;
    if (bytes && isRavFile(bytes)) {
      this.doc = new RavDocument(bytes);
      this.kind = 'rav';
    } else {
      this.doc = new Fr3Document(bytes ? new TextDecoder('utf-8').decode(bytes) : data);
      this.kind = 'fr3';
    }
    this.fileName = fileName || 'relatorio.fr3';
    this.filePath = meta.path || null;
    this.encoding = meta.encoding || 'utf8';
    this.pageIndex = 0;
    this.selection = [];
    this._undo = [];
    this._redo = [];
    this.dirty = false;
    this.emit('doc');
  },

  newDocument() {
    this.doc = Fr3Document.blank();
    this.kind = 'fr3';
    this.fileName = 'novo.fr3';
    this.filePath = null;
    this.encoding = 'utf8';
    this.pageIndex = 0;
    this.selection = [];
    this._undo = [];
    this._redo = [];
    this.dirty = false;
    this.emit('doc');
  },

  get page() {
    if (!this.doc) return null;
    const pages = this.doc.pages;
    return pages[Math.min(this.pageIndex, pages.length - 1)] || null;
  },

  /* ------------------------------ historico ------------------------------- */

  snapshot() {
    return { xml: this.doc.serialize(), selection: this.selection.map(nodeKey) };
  },

  /** Chave de um objeto .rav, para reencontra-lo depois de reindexar. */
  ravKey(object) {
    return object ? `${object.className}|${object.name}|${object.start}` : null;
  },

  /**
   * Alteracao em documento .rav. `fn` devolve o registro de desfazer produzido
   * por RavDocument.setValue (ou false/null se nada mudou). O historico guarda
   * so o trecho de bytes substituido — snapshots do arquivo inteiro seriam
   * pesados demais para projetos de dezenas de MB.
   */
  mutateRav(fn) {
    const selected = this.selection[0];
    const key = selected ? `${selected.className}|${selected.name}` : null;
    const undoRecord = fn();
    if (!undoRecord) return;
    this._undo.push({ rav: undoRecord, selectionKey: key });
    if (this._undo.length > HISTORY_LIMIT) this._undo.shift();
    this._redo.length = 0;
    this.dirty = true;
    this.reselectRav(key);
    this.emit('doc');
  },

  /** Reencontra o objeto selecionado depois que o arquivo foi reindexado. */
  reselectRav(key) {
    if (!key) return;
    const [className, name] = key.split('|');
    const found = this.doc.objects.find(
      (object) => object.className === className && object.name === name
    );
    this.selection = found ? [found] : [];
  },

  /**
   * Executa uma alteracao no documento registrando o estado anterior.
   * @param {() => void|boolean} fn devolve `false` para cancelar o registro
   */
  mutate(fn) {
    if (!this.doc) return;
    if (this.kind === 'rav') return this.mutateRav(fn);
    const before = this.snapshot();
    const result = fn();
    if (result === false) return;
    this._undo.push(before);
    if (this._undo.length > HISTORY_LIMIT) this._undo.shift();
    this._redo.length = 0;
    this.dirty = true;
    this.emit('doc');
  },

  restore(snapshot) {
    this.doc = new Fr3Document(snapshot.xml);
    this.selection = snapshot.selection
      .map((key) => findByKey(this.doc, key))
      .filter(Boolean);
    this.dirty = true;
    this.emit('doc');
  },

  undo() {
    const entry = this._undo.pop();
    if (!entry) return;
    if (entry.rav) {
      this._redo.push({ rav: this.doc.applyPatch(entry.rav), selectionKey: entry.selectionKey });
      this.dirty = true;
      this.reselectRav(entry.selectionKey);
      this.emit('doc');
      return;
    }
    this._redo.push(this.snapshot());
    this.restore(entry);
  },

  redo() {
    const entry = this._redo.pop();
    if (!entry) return;
    if (entry.rav) {
      this._undo.push({ rav: this.doc.applyPatch(entry.rav), selectionKey: entry.selectionKey });
      this.dirty = true;
      this.reselectRav(entry.selectionKey);
      this.emit('doc');
      return;
    }
    this._undo.push(this.snapshot());
    this.restore(entry);
  },

  get canUndo() { return this._undo.length > 0; },
  get canRedo() { return this._redo.length > 0; },

  /* -------------------------------- selecao ------------------------------- */

  select(nodes, additive = false) {
    const list = Array.isArray(nodes) ? nodes.filter(Boolean) : nodes ? [nodes] : [];
    if (additive) {
      const next = this.selection.slice();
      for (const node of list) {
        const at = next.indexOf(node);
        if (at === -1) next.push(node);
        else next.splice(at, 1);
      }
      this.selection = next;
    } else {
      this.selection = list;
    }
    this.emit('selection');
  },

  isSelected(node) {
    return this.selection.includes(node);
  },

  /* ------------------------- opcoes de visualizacao ----------------------- */

  setView(patch) {
    Object.assign(this, patch);
    this.emit('view');
  },

  /* --------------------------- valores de teste --------------------------- */

  setValue(key, value) {
    if (value === '') delete this.values[key];
    else this.values[key] = value;
    saveValues(this.values);
    this.emit('values');
  },

  clearValues() {
    this.values = {};
    saveValues(this.values);
    this.emit('values');
  },
};

/** Chave estavel de um no, para reconstruir a selecao apos undo/redo. */
function nodeKey(node) {
  const name = getAttr(node, 'Name');
  return name ? `name:${name}` : `tag:${node.name}`;
}

function findByKey(doc, key) {
  if (key.startsWith('name:')) return doc.findByName(key.slice(5));
  for (const page of doc.pages) {
    if (page.name === key.slice(4)) return page;
  }
  return null;
}

function loadValues() {
  try {
    return JSON.parse(localStorage.getItem(VALUES_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveValues(values) {
  try {
    localStorage.setItem(VALUES_KEY, JSON.stringify(values));
  } catch {
    /* modo privado / storage cheio: valores ficam apenas em memoria */
  }
}
