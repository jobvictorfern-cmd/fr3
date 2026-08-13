/**
 * Painel "Estrutura": arvore de paginas, bandas e objetos do relatorio.
 */

import { BAND_LABELS, OBJECT_LABELS } from '../core/fr3.js';

export function createTree(store, container) {
  container.addEventListener('click', (event) => {
    const row = event.target.closest('.tree-node');
    if (!row || !row.__node) return;
    store.select(row.__node, event.ctrlKey || event.metaKey || event.shiftKey);
  });

  function render() {
    container.textContent = '';
    if (!store.doc) return;

    for (const [index, page] of store.doc.pages.entries()) {
      const pageRow = row({
        node: page,
        depth: 0,
        kind: 'Pagina',
        name: store.doc.str(page, 'Name', `Page${index + 1}`),
        className: 'tree-branch',
      });
      container.appendChild(pageRow);

      for (const band of store.doc.orderedBands(page)) {
        container.appendChild(row({
          node: band,
          depth: 1,
          kind: BAND_LABELS[band.name] || band.name,
          name: store.doc.str(band, 'Name'),
          className: 'tree-branch',
        }));
        for (const object of store.doc.objectsOf(band)) {
          container.appendChild(objectRow(object, 2));
        }
      }

      for (const object of store.doc.objectsOf(page)) {
        container.appendChild(objectRow(object, 1));
      }
    }
  }

  function objectRow(object, depth) {
    return row({
      node: object,
      depth,
      kind: OBJECT_LABELS[object.name] || object.name.replace(/^Tfrx|View$/g, ''),
      name: store.doc.str(object, 'Name'),
      className: store.doc.bool(object, 'Visible', true) ? '' : 'hidden-obj',
    });
  }

  function row({ node, depth, kind, name, className }) {
    const el = document.createElement('div');
    el.className = `tree-node ${className || ''}`.trim();
    if (store.isSelected(node)) el.classList.add('selected');
    el.style.paddingLeft = 6 + depth * 14 + 'px';
    el.__node = node;

    const kindEl = document.createElement('span');
    kindEl.className = 'kind';
    kindEl.textContent = kind;
    const nameEl = document.createElement('span');
    nameEl.className = 'name';
    nameEl.textContent = name;

    el.append(kindEl, nameEl);
    return el;
  }

  /** Rola a arvore ate o primeiro item selecionado. */
  function revealSelection() {
    const selected = container.querySelector('.tree-node.selected');
    selected?.scrollIntoView({ block: 'nearest' });
  }

  return { render, revealSelection };
}
