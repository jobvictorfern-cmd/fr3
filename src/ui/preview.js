/**
 * Pre-visualizacao: empilha as bandas na ordem de impressao (sem os espacos
 * que o designer mantem entre elas) e substitui as expressoes pelos valores de
 * teste. Serve tambem como saida para impressao/PDF pelo navegador.
 */

import { renderObject } from '../core/render.js';

/** Ordem em que o FastReport imprime as bandas em um relatorio simples. */
const PRINT_ORDER = [
  'TfrxReportTitle',
  'TfrxPageHeader',
  'TfrxColumnHeader',
  'TfrxHeader',
  'TfrxGroupHeader',
  'TfrxMasterData',
  'TfrxDetailData',
  'TfrxSubdetailData',
  'TfrxDataBand4',
  'TfrxDataBand5',
  'TfrxDataBand6',
  'TfrxGroupFooter',
  'TfrxFooter',
  'TfrxColumnFooter',
  'TfrxReportSummary',
  'TfrxChild',
  'TfrxPageFooter',
  'TfrxOverlay',
];

export function createPreview(store, elements) {
  const { root, body, info } = elements;

  function open() {
    render();
    root.hidden = false;
  }

  function close() {
    root.hidden = true;
    body.textContent = '';
  }

  function toggle() {
    if (root.hidden) open();
    else close();
  }

  function render() {
    body.textContent = '';
    const doc = store.doc;
    const page = store.page;
    if (!doc || !page) return;

    const geo = doc.pageGeometry(page);
    const sheet = document.createElement('div');
    sheet.className = 'preview-page';
    sheet.style.width = geo.width + 'px';
    sheet.style.height = geo.height + 'px';

    const work = document.createElement('div');
    work.style.position = 'absolute';
    work.style.left = geo.left + 'px';
    work.style.top = geo.top + 'px';
    work.style.width = geo.width - geo.left - geo.right + 'px';
    sheet.appendChild(work);

    const options = { resolve: true, values: store.values };
    const bands = doc.bands(page)
      .filter((band) => doc.bool(band, 'Visible', true))
      .sort(compareBands(doc));

    // Rodape de pagina fica preso a base da folha, como na impressao.
    const footers = bands.filter((band) => band.name === 'TfrxPageFooter');
    const flow = bands.filter((band) => band.name !== 'TfrxPageFooter');

    let cursor = 0;
    for (const band of flow) {
      const height = doc.num(band, 'Height');
      const el = document.createElement('div');
      el.style.position = 'absolute';
      el.style.left = doc.num(band, 'Left') + 'px';
      el.style.top = cursor + 'px';
      el.style.width = doc.num(band, 'Width') + 'px';
      el.style.height = height + 'px';
      for (const object of doc.objectsOf(band)) {
        if (!doc.bool(object, 'Visible', true)) continue;
        el.appendChild(renderObject(doc, object, options));
      }
      work.appendChild(el);
      cursor += height;
    }

    let footerTop = geo.height - geo.top - geo.bottom;
    for (const band of footers.reverse()) {
      const height = doc.num(band, 'Height');
      footerTop -= height;
      const el = document.createElement('div');
      el.style.position = 'absolute';
      el.style.left = doc.num(band, 'Left') + 'px';
      el.style.top = footerTop + 'px';
      el.style.width = doc.num(band, 'Width') + 'px';
      el.style.height = height + 'px';
      for (const object of doc.objectsOf(band)) {
        if (!doc.bool(object, 'Visible', true)) continue;
        el.appendChild(renderObject(doc, object, options));
      }
      work.appendChild(el);
    }

    // Objetos ancorados diretamente na pagina.
    for (const object of doc.objectsOf(page)) {
      if (!doc.bool(object, 'Visible', true)) continue;
      work.appendChild(renderObject(doc, object, options));
    }

    body.appendChild(sheet);

    const missing = doc.expressions().filter((expr) => !store.values[expr]).length;
    info.textContent = `${geo.paperWidth} × ${geo.paperHeight} mm · ${bands.length} bandas`
      + (missing ? ` · ${missing} expressoes sem valor de teste` : '');
  }

  return { open, close, toggle, render, get isOpen() { return !root.hidden; } };
}

function compareBands(doc) {
  return (a, b) => {
    const orderA = PRINT_ORDER.indexOf(a.name);
    const orderB = PRINT_ORDER.indexOf(b.name);
    if (orderA !== orderB) return orderA - orderB;
    return doc.num(a, 'Top') - doc.num(b, 'Top');
  };
}
