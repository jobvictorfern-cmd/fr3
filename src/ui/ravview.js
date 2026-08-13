/**
 * Interface para arquivos .rav: arvore de paginas/objetos e painel de
 * propriedades.
 *
 * Nao ha area de desenho como no .fr3 — o Rave guarda coordenadas em
 * polegadas e um conjunto proprio de objetos, e a renderizacao fiel ainda nao
 * foi implementada. O que existe aqui edita o relatorio pela estrutura: achar
 * o objeto, ver e alterar suas propriedades.
 */

import { TAG, INCH_TO_MM } from '../core/rav.js';

const CLASS_LABELS = {
  TRaveText: 'Texto',
  TRaveMemo: 'Memo',
  TRaveDataText: 'Campo de dados',
  TRaveDataMemo: 'Memo de dados',
  TRaveHLine: 'Linha horizontal',
  TRaveVLine: 'Linha vertical',
  TRaveLine: 'Linha',
  TRaveRectangle: 'Retangulo',
  TRaveSection: 'Secao',
  TRaveRegion: 'Regiao',
  TRaveBand: 'Banda',
  TRaveBitmap: 'Imagem',
  TRavePage: 'Pagina',
  TRaveReport: 'Relatorio',
  TRaveDataView: 'Fonte de dados',
  TRaveDataBand: 'Banda de dados',
};

const TAG_LABELS = {
  [TAG.IDENT]: 'opcao',
  [TAG.INT8]: 'inteiro',
  [TAG.INT16]: 'inteiro',
  [TAG.INT32]: 'inteiro',
  [TAG.INT64]: 'inteiro longo',
  [TAG.EXTENDED]: 'medida',
  [TAG.STRING]: 'texto',
  [TAG.SET]: 'conjunto',
  [TAG.OBJECT]: 'objeto',
  [TAG.BINARY]: 'binario',
};

/** Propriedades que aparecem primeiro no painel, nesta ordem. */
const PRIORITY = ['Name', 'Text', 'DataField', 'FullName', 'Left', 'Top', 'Width', 'Height', 'Visible'];

export function createRavView(store, elements) {
  const { tree, inspector, inspectorTitle, canvas } = elements;
  let filter = '';

  tree.addEventListener('click', (event) => {
    const row = event.target.closest('.tree-node');
    if (!row || row.__object === undefined) return;
    store.select(row.__object);
  });

  /* --------------------------------- arvore -------------------------------- */

  function renderTree() {
    tree.textContent = '';
    const doc = store.doc;
    if (!doc) return;

    const search = document.createElement('div');
    search.className = 'data-row';
    search.style.padding = '6px 8px';
    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = 'filtrar objeto…';
    input.value = filter;
    input.addEventListener('input', () => {
      filter = input.value.trim().toLowerCase();
      renderTree();
      tree.querySelector('input')?.focus();
    });
    search.appendChild(input);
    search.style.gridTemplateColumns = '1fr';
    tree.appendChild(search);

    for (const report of doc.outline()) {
      for (const page of report.pages) {
        const items = page.items.filter(matches);
        if (filter && !items.length) continue;

        tree.appendChild(row({
          object: page.object,
          depth: 0,
          kind: 'Pagina',
          name: page.name,
          className: 'tree-branch',
        }));
        for (const item of items) {
          tree.appendChild(row({
            object: item,
            depth: 1,
            kind: CLASS_LABELS[item.className] || item.className.replace(/^TRave/, ''),
            name: item.name || doc.displayText(item).slice(0, 24),
          }));
        }
      }
    }
  }

  function matches(object) {
    if (!filter) return true;
    const haystack = `${object.name} ${object.className} ${store.doc.displayText(object)}`.toLowerCase();
    return haystack.includes(filter);
  }

  function row({ object, depth, kind, name, className }) {
    const el = document.createElement('div');
    el.className = `tree-node ${className || ''}`.trim();
    if (store.selection[0] === object) el.classList.add('selected');
    el.style.paddingLeft = 6 + depth * 14 + 'px';
    el.__object = object;

    const kindEl = document.createElement('span');
    kindEl.className = 'kind';
    kindEl.textContent = kind;
    const nameEl = document.createElement('span');
    nameEl.className = 'name';
    nameEl.textContent = name;
    el.append(kindEl, nameEl);
    return el;
  }

  /* ------------------------------- propriedades ---------------------------- */

  function renderInspector() {
    inspector.textContent = '';
    const doc = store.doc;
    const object = store.selection[0];

    if (!doc) return;
    if (!object) {
      inspectorTitle.textContent = 'Projeto Rave';
      const stats = doc.stats;
      const group = section('Resumo');
      info(group, 'Tamanho', `${(stats.size / 1048576).toFixed(1)} MB`);
      info(group, 'Objetos', String(doc.reportObjects.length));
      for (const [className, total] of stats.byClass.slice(0, 8)) {
        info(group, CLASS_LABELS[className] || className.replace(/^TRave/, ''), String(total));
      }
      const hint = document.createElement('div');
      hint.className = 'insp-empty';
      hint.textContent = 'Selecione um objeto na estrutura para ver e editar as propriedades.';
      inspector.appendChild(hint);
      return;
    }

    inspectorTitle.textContent = `${CLASS_LABELS[object.className] || object.className} · ${object.name}`;

    const geometry = doc.rectMm(object);
    if (geometry) {
      const group = section('Posicao e tamanho (mm)');
      for (const [label, prop] of [['Esquerda', 'Left'], ['Topo', 'Top'], ['Largura', 'Width'], ['Altura', 'Height']]) {
        const property = doc.property(object, prop);
        if (property) measureField(group, label, property);
      }
    }

    const editable = section('Propriedades');
    const others = section('Somente leitura', false);
    const sorted = [...object.properties].sort(byPriority);

    for (const property of sorted) {
      if (['Left', 'Top', 'Width', 'Height'].includes(property.name) && geometry) continue;
      if (property.editable) valueField(editable, property);
      else readOnlyField(others, property);
    }
  }

  function byPriority(a, b) {
    const rank = (property) => {
      const index = PRIORITY.indexOf(property.name);
      return index === -1 ? PRIORITY.length : index;
    };
    return rank(a) - rank(b) || a.name.localeCompare(b.name);
  }

  function section(title, open = true) {
    const details = document.createElement('details');
    details.className = 'insp-group';
    details.open = open;
    const summary = document.createElement('summary');
    summary.textContent = title;
    details.appendChild(summary);
    inspector.appendChild(details);
    return details;
  }

  function line(parent, label, control) {
    const el = document.createElement('div');
    el.className = 'insp-row';
    const labelEl = document.createElement('label');
    labelEl.textContent = label;
    el.append(labelEl, control);
    parent.appendChild(el);
    return control;
  }

  function info(parent, label, text) {
    const span = document.createElement('span');
    span.textContent = text;
    return line(parent, label, span);
  }

  /** Medida gravada em polegadas, exibida e editada em milimetros. */
  function measureField(parent, label, property) {
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '0.1';
    input.value = (property.value * INCH_TO_MM).toFixed(2);
    input.addEventListener('change', () => {
      const mm = Number(input.value.replace(',', '.'));
      if (!Number.isFinite(mm)) return;
      store.mutate(() => store.doc.setValue(property, mm / INCH_TO_MM));
    });
    return line(parent, label, input);
  }

  function valueField(parent, property) {
    const multiline = property.tag === TAG.STRING && String(property.value).includes('\r');
    const input = document.createElement(multiline ? 'textarea' : 'input');
    if (!multiline) input.type = property.numeric ? 'number' : 'text';
    input.value = property.tag === TAG.EXTENDED ? property.value : String(property.value ?? '');
    input.addEventListener('change', () => {
      const raw = property.numeric ? Number(input.value.replace(',', '.')) : input.value;
      if (property.numeric && !Number.isFinite(raw)) return;
      store.mutate(() => store.doc.setValue(property, raw));
    });
    const control = line(parent, property.name, input);
    if (multiline) control.parentElement.classList.add('full');
    return control;
  }

  function readOnlyField(parent, property) {
    const span = document.createElement('span');
    const kind = TAG_LABELS[property.tag] || `tipo ${property.tag}`;
    span.textContent = Array.isArray(property.value)
      ? property.value.join(', ') || `(${kind} vazio)`
      : property.value !== null && property.value !== undefined
        ? String(property.value)
        : `(${kind})`;
    span.style.color = 'var(--text-dim)';
    return line(parent, property.name, span);
  }

  /* --------------------------------- canvas -------------------------------- */

  function renderCanvas() {
    canvas.textContent = '';
    const object = store.selection[0];
    const panel = document.createElement('div');
    panel.className = 'rav-panel';

    if (!object) {
      panel.innerHTML = '<h3>Projeto Rave (.rav)</h3>';
      const p = document.createElement('p');
      p.textContent =
        'Escolha um objeto na estrutura à esquerda. As propriedades aparecem à direita e '
        + 'podem ser editadas; tudo que você não alterar continua idêntico no arquivo salvo.';
      panel.appendChild(p);
    } else {
      const title = document.createElement('h3');
      title.textContent = `${CLASS_LABELS[object.className] || object.className} · ${object.name}`;
      panel.appendChild(title);

      const text = store.doc.displayText(object);
      if (text) {
        const pre = document.createElement('pre');
        pre.className = 'rav-text';
        pre.textContent = text;
        panel.appendChild(pre);
      }
      const rect = store.doc.rectMm(object);
      if (rect) {
        const dims = document.createElement('p');
        dims.textContent =
          `Posição ${rect.left.toFixed(1)} ; ${rect.top.toFixed(1)} mm · `
          + `Tamanho ${rect.width.toFixed(1)} × ${rect.height.toFixed(1)} mm`;
        panel.appendChild(dims);
      }
      const count = document.createElement('p');
      count.className = 'muted';
      const editables = object.properties.filter((property) => property.editable).length;
      count.textContent = `${object.properties.length} propriedades · ${editables} editáveis`;
      panel.appendChild(count);
    }
    canvas.appendChild(panel);
  }

  function render() {
    renderTree();
    renderInspector();
    renderCanvas();
  }

  return { render, renderTree, renderInspector, renderCanvas };
}
