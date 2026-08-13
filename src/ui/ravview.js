/**
 * Interface para arquivos .rav: pagina desenhada, arvore de paginas/objetos e
 * painel de propriedades.
 *
 * O desenho e uma aproximacao — o Rave tem seu proprio motor de renderizacao —
 * mas serve para achar o objeto na folha, arrastar e conferir o resultado. A
 * edicao precisa continua sendo pelo painel de propriedades.
 */

import { TAG, INCH_TO_MM } from '../core/rav.js';
import { renderRavObject, drawableItems, inchToPx } from '../core/ravrender.js';

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

  /** Todas as paginas do projeto, na ordem do arquivo. */
  function allPages() {
    return store.doc.outline().flatMap((report) => report.pages);
  }

  /** Pagina mostrada: a do objeto selecionado, ou a primeira com conteudo. */
  function currentPage() {
    const pages = allPages();
    if (!pages.length) return null;
    const selected = store.selection[0];
    if (selected) {
      const found = pages.find(
        (page) => page.object === selected || page.items.includes(selected)
      );
      if (found) return found;
    }
    return pages.find((page) => drawableItems(store.doc, page).length) || pages[0];
  }

  function renderCanvas() {
    canvas.textContent = '';
    const doc = store.doc;
    if (!doc) return;

    const page = currentPage();
    if (!page) {
      const empty = document.createElement('div');
      empty.className = 'rav-panel';
      empty.textContent = 'Nenhuma pagina encontrada neste projeto.';
      canvas.appendChild(empty);
      return;
    }

    canvas.appendChild(buildPagePicker(page));


    const size = doc.pageSize(page.object);
    const sheet = document.createElement('div');
    sheet.className = 'page rav-page';
    sheet.style.width = inchToPx(size.width) + 'px';
    sheet.style.height = inchToPx(size.height) + 'px';
    sheet.style.transform = `scale(${store.zoom})`;
    sheet.style.transformOrigin = '0 0';

    const items = drawableItems(doc, page);
    for (const item of items) {
      const el = renderRavObject(doc, item);
      if (!el) continue;
      el.__object = item;
      el.title = `${CLASS_LABELS[item.className] || item.className}: ${item.name}`;
      if (store.selection[0] === item) el.classList.add('selected');
      sheet.appendChild(el);
    }

    const holder = document.createElement('div');
    holder.className = 'rav-sheet-holder';
    holder.style.width = inchToPx(size.width) * store.zoom + 'px';
    holder.style.height = inchToPx(size.height) * store.zoom + 'px';
    holder.appendChild(sheet);
    canvas.appendChild(holder);

    if (!items.length) {
      const note = document.createElement('p');
      note.className = 'rav-note';
      note.textContent =
        'Esta pagina nao tem objetos com posicao definida — provavelmente e uma pagina de codigo ou de dados.';
      canvas.appendChild(note);
    }

    sheet.addEventListener('pointerdown', onSheetPointerDown);
  }

  /** Lista de paginas do projeto, com a quantidade de objetos desenhaveis. */
  function buildPagePicker(current) {
    const bar = document.createElement('div');
    bar.className = 'rav-pagebar';

    const label = document.createElement('span');
    label.textContent = 'Pagina';
    const select = document.createElement('select');
    const pages = allPages();
    pages.forEach((page, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = `${page.name} (${drawableItems(store.doc, page).length})`;
      // A comparacao e pelo objeto da pagina: `outline()` monta agrupamentos
      // novos a cada chamada, entao comparar os agrupamentos falharia.
      option.selected = page.object === current.object;
      select.appendChild(option);
    });
    select.addEventListener('change', () => {
      const page = allPages()[Number(select.value)];
      if (page) store.select(page.object);
    });

    const info = document.createElement('span');
    info.className = 'muted';
    const size = store.doc.pageSize(current.object);
    info.textContent =
      `${(size.width * INCH_TO_MM).toFixed(0)} × ${(size.height * INCH_TO_MM).toFixed(0)} mm`
      + ` · ${drawableItems(store.doc, current).length} objetos`;

    bar.append(label, select, info);
    return bar;
  }

  /** Arrastar move o objeto; a posicao e gravada ao soltar. */
  function onSheetPointerDown(event) {
    const target = event.target.closest('.rav-obj');
    if (!target || !target.__object) return;
    const object = target.__object;
    store.select(object);

    const rect = store.doc.rect(object);
    if (!rect) return;
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = { x: 0, y: 0 };

    const move = (moveEvent) => {
      moved = {
        x: (moveEvent.clientX - startX) / store.zoom / 96,
        y: (moveEvent.clientY - startY) / store.zoom / 96,
      };
      target.style.left = inchToPx(rect.left + moved.x) + 'px';
      target.style.top = inchToPx(rect.top + moved.y) + 'px';
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (Math.abs(moved.x) < 0.005 && Math.abs(moved.y) < 0.005) return;
      store.mutate(() =>
        store.doc.setMany(object, { Left: rect.left + moved.x, Top: rect.top + moved.y })
      );
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    event.preventDefault();
  }

  /** Zoom que faz a folha caber na area visivel. */
  function fitZoom() {
    const page = store.doc && currentPage();
    if (!page) return 1;
    const size = store.doc.pageSize(page.object);
    const available = canvas.parentElement.clientWidth - 60;
    return Math.max(0.15, Math.min(2, available / inchToPx(size.width)));
  }

  function render() {
    renderTree();
    renderInspector();
    renderCanvas();
  }

  return { render, renderTree, renderInspector, renderCanvas, fitZoom };
}
