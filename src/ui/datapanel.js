/**
 * Painel "Dados": variaveis do relatorio, datasets e os valores de teste
 * usados na pre-visualizacao.
 *
 * Os valores de teste ficam apenas no navegador (localStorage) — eles nunca
 * sao gravados no .fr3.
 */

export function createDataPanel(store, container) {
  function render() {
    container.textContent = '';
    const doc = store.doc;
    if (!doc) return;

    /* ------------------------------ variaveis ----------------------------- */
    const varsTitle = document.createElement('h4');
    varsTitle.textContent = 'Variaveis do relatorio';
    container.appendChild(varsTitle);

    const variables = doc.variables();
    if (!variables.length) {
      container.appendChild(hint('Nenhuma variavel declarada.'));
    }
    for (const variable of variables) {
      const row = document.createElement('div');
      row.className = 'data-row';

      const name = document.createElement('input');
      name.className = 'key';
      name.value = variable.name;
      name.addEventListener('change', () => {
        store.mutate(() => doc.setStr(variable.node, 'Name', name.value.trim()));
      });

      const value = document.createElement('input');
      value.placeholder = 'valor de teste';
      value.value = store.values[variable.name] ?? '';
      value.addEventListener('change', () => store.setValue(variable.name, value.value));

      const remove = document.createElement('button');
      remove.className = 'mini-btn danger';
      remove.textContent = '×';
      remove.title = 'Remover variavel';
      remove.addEventListener('click', () => store.mutate(() => doc.remove(variable.node)));

      row.append(name, value, remove);
      container.appendChild(row);
    }

    const addRow = document.createElement('div');
    addRow.className = 'data-row';
    const newName = document.createElement('input');
    newName.placeholder = 'nova variavel';
    const addButton = document.createElement('button');
    addButton.className = 'mini-btn';
    addButton.textContent = 'Adicionar';
    const add = () => {
      const name = newName.value.trim();
      if (!name) return;
      store.mutate(() => doc.addVariable(name));
    };
    addButton.addEventListener('click', add);
    newName.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') add();
      event.stopPropagation();
    });
    addRow.append(newName, addButton);
    container.appendChild(addRow);

    /* ------------------------------- datasets ----------------------------- */
    const datasets = doc.datasets();
    if (datasets.length) {
      const title = document.createElement('h4');
      title.textContent = 'Datasets';
      container.appendChild(title);
      for (const dataset of datasets) {
        container.appendChild(hint(dataset.name));
      }
    }

    /* --------------------------- expressoes usadas ------------------------ */
    const exprTitle = document.createElement('h4');
    exprTitle.textContent = 'Expressoes usadas no layout';
    container.appendChild(exprTitle);
    container.appendChild(hint('Preencha para ver o resultado na pre-visualizacao.'));

    const expressions = doc.expressions();
    if (!expressions.length) container.appendChild(hint('Nenhuma expressao [..] encontrada.'));

    for (const expression of expressions) {
      const row = document.createElement('div');
      row.className = 'data-row';
      const key = document.createElement('input');
      key.className = 'key';
      key.value = expression;
      key.readOnly = true;
      key.title = expression;
      const value = document.createElement('input');
      value.placeholder = 'valor de teste';
      value.value = store.values[expression] ?? '';
      value.addEventListener('change', () => store.setValue(expression, value.value));
      const clear = document.createElement('button');
      clear.className = 'mini-btn';
      clear.textContent = '×';
      clear.title = 'Limpar valor';
      clear.addEventListener('click', () => {
        store.setValue(expression, '');
        value.value = '';
      });
      row.append(key, value, clear);
      container.appendChild(row);
    }

    const tools = document.createElement('div');
    tools.className = 'insp-actions';
    const clearAll = document.createElement('button');
    clearAll.className = 'mini-btn danger';
    clearAll.textContent = 'Limpar valores de teste';
    clearAll.addEventListener('click', () => store.clearValues());
    tools.appendChild(clearAll);
    container.appendChild(tools);
  }

  function hint(text) {
    const el = document.createElement('div');
    el.className = 'data-hint';
    el.textContent = text;
    return el;
  }

  return { render };
}
