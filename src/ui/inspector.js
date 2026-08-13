/**
 * Painel de propriedades. Os campos sao gerados a partir de descricoes
 * declarativas por tipo de objeto; cada campo le e grava direto no atributo
 * correspondente do XML.
 */

import { isBand, isPage, OBJECT_LABELS, BAND_LABELS } from '../core/fr3.js';
import {
  colorToCss,
  cssToColor,
  fontHeightToPt,
  ptToFontHeight,
  FONT_STYLE,
  FRAME_BITS,
  pxToMm,
  mmToPx,
} from '../core/units.js';
import { imageDataToBmp, bmpToPropData } from '../core/picture.js';
import { invalidatePicture } from '../core/render.js';

const H_ALIGN = [
  ['haLeft', 'Esquerda'],
  ['haCenter', 'Centro'],
  ['haRight', 'Direita'],
  ['haBlock', 'Justificado'],
];

const V_ALIGN = [
  ['vaTop', 'Topo'],
  ['vaCenter', 'Meio'],
  ['vaBottom', 'Base'],
];

const STRETCH = [
  ['smDontStretch', 'Nao esticar'],
  ['smActualHeight', 'Altura real'],
  ['smMaxHeight', 'Altura maxima'],
];

const FRAME_STYLE_OPTIONS = [
  ['fsSolid', 'Solida'],
  ['fsDash', 'Tracejada'],
  ['fsDot', 'Pontilhada'],
  ['fsDashDot', 'Traco-ponto'],
  ['fsDouble', 'Dupla'],
];

const SHAPES = [
  ['skRectangle', 'Retangulo'],
  ['skRoundRectangle', 'Retangulo arredondado'],
  ['skEllipse', 'Elipse'],
  ['skTriangle', 'Triangulo'],
  ['skDiamond', 'Losango'],
];

const FORMAT_KINDS = [
  ['fkText', 'Texto'],
  ['fkNumeric', 'Numerico'],
  ['fkDateTime', 'Data/hora'],
  ['fkBoolean', 'Booleano'],
];

const PAPER_PRESETS = [
  ['9', 'A4 210 × 297', 210, 297],
  ['11', 'A5 148 × 210', 148, 210],
  ['1', 'Carta 216 × 279', 215.9, 279.4],
  ['256', 'Bobina 80 mm', 80, 297],
  ['256', 'Bobina 58 mm', 58, 210],
];

const FONTS = ['Arial', 'Times New Roman', 'Courier New', 'Tahoma', 'Verdana', 'Calibri', 'Segoe UI'];

export function createInspector(store, container, titleEl) {
  let skipNextRender = false;

  /** Aplica uma alteracao sem reconstruir o painel (mantem o foco no campo). */
  function commit(fn) {
    skipNextRender = true;
    store.mutate(fn);
  }

  function render() {
    if (skipNextRender) {
      skipNextRender = false;
      return;
    }
    container.textContent = '';
    const doc = store.doc;
    if (!doc) {
      titleEl.textContent = 'Propriedades';
      container.append(empty('Abra um arquivo .fr3 para comecar.'));
      return;
    }

    const selection = store.selection.filter(Boolean);
    if (selection.length === 0) {
      titleEl.textContent = 'Relatorio';
      renderReport(doc);
      return;
    }
    if (selection.length > 1) {
      titleEl.textContent = `${selection.length} objetos selecionados`;
      renderMultiple(doc, selection);
      return;
    }

    const node = selection[0];
    if (isPage(node)) {
      titleEl.textContent = 'Pagina';
      renderPage(doc, node);
    } else if (isBand(node)) {
      titleEl.textContent = BAND_LABELS[node.name] || node.name;
      renderBand(doc, node);
    } else {
      titleEl.textContent = OBJECT_LABELS[node.name] || node.name;
      renderObjectProps(doc, node);
    }
  }

  /* ------------------------------ construtores ----------------------------- */

  function empty(text) {
    const el = document.createElement('div');
    el.className = 'insp-empty';
    el.textContent = text;
    return el;
  }

  function group(title, open = true) {
    const details = document.createElement('details');
    details.className = 'insp-group';
    details.open = open;
    const summary = document.createElement('summary');
    summary.textContent = title;
    details.appendChild(summary);
    container.appendChild(details);
    return details;
  }

  function row(parent, label, control, className = '') {
    const el = document.createElement('div');
    el.className = `insp-row ${className}`.trim();
    if (label !== null) {
      const labelEl = document.createElement('label');
      labelEl.textContent = label;
      el.appendChild(labelEl);
    }
    el.appendChild(control);
    parent.appendChild(el);
    return control;
  }

  function textField(parent, label, node, attr, { multiline = false } = {}) {
    const input = document.createElement(multiline ? 'textarea' : 'input');
    if (!multiline) input.type = 'text';
    input.value = store.doc.str(node, attr, '');
    input.dataset.key = attr;
    input.addEventListener('change', () => {
      const value = multiline ? input.value.replace(/\r?\n/g, '\r\n') : input.value;
      commit(() => store.doc.setStr(node, attr, value));
    });
    return row(parent, label, input, multiline ? 'full' : '');
  }

  /** Campo numerico que respeita a unidade escolhida na barra de ferramentas. */
  function sizeField(parent, label, node, attr, onCommit) {
    const input = document.createElement('input');
    input.type = 'number';
    input.step = store.unit === 'mm' ? '0.1' : '1';
    const px = store.doc.num(node, attr);
    input.value = store.unit === 'mm' ? round(pxToMm(px), 2) : round(px, 2);
    input.addEventListener('change', () => {
      const value = Number(input.value.replace(',', '.')) || 0;
      const asPx = store.unit === 'mm' ? mmToPx(value) : value;
      commit(() => (onCommit ? onCommit(asPx) : store.doc.setNum(node, attr, asPx)));
    });
    return row(parent, label, input);
  }

  function numberField(parent, label, node, attr, { step = 1, min, max, decimals = 0 } = {}) {
    const input = document.createElement('input');
    input.type = 'number';
    input.step = String(step);
    if (min !== undefined) input.min = String(min);
    if (max !== undefined) input.max = String(max);
    input.value = round(store.doc.num(node, attr), decimals);
    input.addEventListener('change', () => {
      const value = Number(input.value.replace(',', '.')) || 0;
      commit(() => store.doc.setNum(node, attr, value, decimals));
    });
    return row(parent, label, input);
  }

  function boolField(parent, label, node, attr, defaultValue = false) {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = store.doc.bool(node, attr, defaultValue);
    input.addEventListener('change', () => {
      commit(() => store.doc.setBool(node, attr, input.checked));
    });
    const wrap = document.createElement('div');
    wrap.className = 'insp-inline';
    wrap.appendChild(input);
    return row(parent, label, wrap);
  }

  function selectField(parent, label, node, attr, options, fallback) {
    const select = document.createElement('select');
    const current = store.doc.str(node, attr, fallback);
    for (const [value, text] of options) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      option.selected = value === current;
      select.appendChild(option);
    }
    select.addEventListener('change', () => {
      commit(() => store.doc.setStr(node, attr, select.value));
    });
    return row(parent, label, select);
  }

  /** Cor solida; com `allowNone`, oferece a opcao "transparente" (clNone). */
  function colorField(parent, label, node, attr, { allowNone = false, fallback = 0 } = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'insp-inline';
    const current = store.doc.has(node, attr) ? store.doc.num(node, attr, fallback) : fallback;
    const css = colorToCss(current);

    const input = document.createElement('input');
    input.type = 'color';
    input.value = css || '#ffffff';
    input.addEventListener('change', () => {
      commit(() => store.doc.setNum(node, attr, cssToColor(input.value), 0));
    });

    if (allowNone) {
      const none = document.createElement('label');
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = !css;
      check.addEventListener('change', () => {
        commit(() => {
          if (check.checked) store.doc.setStr(node, attr, null);
          else store.doc.setNum(node, attr, cssToColor(input.value), 0);
        });
      });
      none.append(check, document.createTextNode('transparente'));
      input.disabled = !css;
      wrap.append(input, none);
    } else {
      wrap.appendChild(input);
    }
    return row(parent, label, wrap);
  }

  function flagsField(parent, label, node, attr, bits, defaultValue = 0) {
    const wrap = document.createElement('div');
    wrap.className = 'insp-inline';
    const current = store.doc.num(node, attr, defaultValue);
    for (const [bit, text] of bits) {
      const labelEl = document.createElement('label');
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = (current & bit) !== 0;
      check.addEventListener('change', () => {
        commit(() => {
          const value = store.doc.num(node, attr, defaultValue);
          store.doc.setNum(node, attr, check.checked ? value | bit : value & ~bit, 0);
        });
      });
      labelEl.append(check, document.createTextNode(text));
      wrap.appendChild(labelEl);
    }
    return row(parent, label, wrap);
  }

  function button(parent, text, onClick, className = 'mini-btn') {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = className;
    el.textContent = text;
    el.addEventListener('click', onClick);
    parent.appendChild(el);
    return el;
  }

  function actions(parent) {
    const el = document.createElement('div');
    el.className = 'insp-actions';
    parent.appendChild(el);
    return el;
  }

  /* -------------------------------- secoes -------------------------------- */

  function renderReport(doc) {
    const info = group('Relatorio');
    row(info, 'Versao', staticText(doc.str(doc.report, 'Version', '—')));
    row(info, 'Paginas', staticText(String(doc.pages.length)));
    row(info, 'Variaveis', staticText(String(doc.variables().length)));
    row(info, 'Datasets', staticText(String(doc.datasets().length || '—')));
    textField(info, 'Descricao', doc.report, 'ReportOptions.Description.Text');

    const script = group('Script (PascalScript)', false);
    textField(script, null, doc.report, 'ScriptText.Text', { multiline: true });

    container.append(empty('Selecione uma banda ou um objeto na pagina para editar suas propriedades.'));
  }

  function staticText(text) {
    const el = document.createElement('span');
    el.textContent = text;
    return el;
  }

  function renderPage(doc, page) {
    const geometry = group('Papel');
    const preset = document.createElement('select');
    const currentW = doc.num(page, 'PaperWidth');
    const currentH = doc.num(page, 'PaperHeight');
    const custom = document.createElement('option');
    custom.textContent = 'Personalizado';
    custom.value = '';
    preset.appendChild(custom);
    for (const [size, label, w, h] of PAPER_PRESETS) {
      const option = document.createElement('option');
      option.value = `${size}|${w}|${h}`;
      option.textContent = label;
      option.selected = Math.abs(w - currentW) < 0.5 && Math.abs(h - currentH) < 0.5;
      preset.appendChild(option);
    }
    preset.addEventListener('change', () => {
      if (!preset.value) return;
      const [size, w, h] = preset.value.split('|');
      skipNextRender = false;
      store.mutate(() => {
        doc.setStr(page, 'PaperSize', size);
        doc.setNum(page, 'PaperWidth', Number(w));
        doc.setNum(page, 'PaperHeight', Number(h));
      });
    });
    row(geometry, 'Tamanho', preset);
    numberField(geometry, 'Largura (mm)', page, 'PaperWidth', { step: 1, decimals: 2 });
    numberField(geometry, 'Altura (mm)', page, 'PaperHeight', { step: 1, decimals: 2 });

    const margins = group('Margens (mm)');
    numberField(margins, 'Esquerda', page, 'LeftMargin', { step: 1, decimals: 2 });
    numberField(margins, 'Direita', page, 'RightMargin', { step: 1, decimals: 2 });
    numberField(margins, 'Superior', page, 'TopMargin', { step: 1, decimals: 2 });
    numberField(margins, 'Inferior', page, 'BottomMargin', { step: 1, decimals: 2 });

    const bandsGroup = group('Bandas');
    const list = actions(bandsGroup);
    button(list, 'Girar papel', () => {
      store.mutate(() => {
        const w = doc.num(page, 'PaperWidth');
        doc.setNum(page, 'PaperWidth', doc.num(page, 'PaperHeight'));
        doc.setNum(page, 'PaperHeight', w);
      });
    });
    button(list, 'Ajustar bandas a largura', () => {
      store.mutate(() => {
        const width = doc.contentWidth(page);
        for (const band of doc.bands(page)) doc.setNum(band, 'Width', width);
      });
    });
  }

  function renderBand(doc, band) {
    const general = group('Geral');
    textField(general, 'Nome', band, 'Name');
    boolField(general, 'Visivel', band, 'Visible', true);
    sizeField(general, 'Altura', band, 'Height', (px) => doc.resizeBand(band, px));
    sizeField(general, 'Topo', band, 'Top');
    sizeField(general, 'Largura', band, 'Width');

    if (doc.has(band, 'DataSetName') || band.name.includes('Data')) {
      const data = group('Dados');
      const datasets = doc.datasets().map((d) => [d.name, d.name]);
      selectField(data, 'Dataset', band, 'DataSetName', [['', '(nenhum)'], ...datasets], '');
      numberField(data, 'Linhas fixas', band, 'RowCount');
    }

    const layout = group('Quebras', false);
    boolField(layout, 'Nova pagina', band, 'StartNewPage', false);
    boolField(layout, 'Imprimir se vazio', band, 'PrintIfDetailEmpty', false);
    boolField(layout, 'Manter junto', band, 'KeepChild', false);

    appendFrameGroup(doc, band, { fill: true });

    const tools = actions(group('Acoes', true));
    button(tools, 'Excluir banda', () => {
      store.mutate(() => {
        doc.remove(band);
        store.selection = [];
      });
    }, 'mini-btn danger');
  }

  function renderObjectProps(doc, node) {
    const general = group('Geral');
    textField(general, 'Nome', node, 'Name');
    boolField(general, 'Visivel', node, 'Visible', true);
    boolField(general, 'Imprimivel', node, 'Printable', true);

    const geometry = group('Posicao e tamanho');
    sizeField(geometry, `Esquerda (${store.unit})`, node, 'Left');
    sizeField(geometry, `Topo (${store.unit})`, node, 'Top');
    sizeField(geometry, `Largura (${store.unit})`, node, 'Width');
    sizeField(geometry, `Altura (${store.unit})`, node, 'Height');

    if (node.name === 'TfrxMemoView' || node.name === 'TfrxBarCodeView') {
      const content = group('Conteudo');
      textField(content, null, node, 'Text', { multiline: true });
      const hint = document.createElement('div');
      hint.className = 'data-hint';
      hint.textContent = 'Use [variavel] ou [Dataset."campo"] para valores dinamicos.';
      content.appendChild(hint);
    }

    if (node.name === 'TfrxMemoView') {
      appendFontGroup(doc, node);

      const layout = group('Texto');
      selectField(layout, 'Horizontal', node, 'HAlign', H_ALIGN, 'haLeft');
      selectField(layout, 'Vertical', node, 'VAlign', V_ALIGN, 'vaTop');
      boolField(layout, 'Quebra de linha', node, 'WordWrap', true);
      boolField(layout, 'Largura automatica', node, 'AutoWidth', false);
      boolField(layout, 'Pode crescer', node, 'CanGrow', false);
      boolField(layout, 'Pode encolher', node, 'CanShrink', false);
      selectField(layout, 'Esticar', node, 'StretchMode', [['', '(padrao)'], ...STRETCH], '');
      numberField(layout, 'Rotacao', node, 'Rotation', { step: 90, min: 0, max: 270 });

      const format = group('Formato e dados', false);
      selectField(format, 'Tipo', node, 'DisplayFormat.Kind', [['', '(nenhum)'], ...FORMAT_KINDS], '');
      textField(format, 'Mascara', node, 'DisplayFormat.FormatStr');
      const datasets = doc.datasets().map((d) => [d.name, d.name]);
      selectField(format, 'Dataset', node, 'DataSetName', [['', '(nenhum)'], ...datasets], '');
      textField(format, 'Campo', node, 'DataField');
    }

    if (node.name === 'TfrxLineView') {
      const line = group('Linha');
      colorField(line, 'Cor', node, 'Color');
      numberField(line, 'Espessura', node, 'Frame.Width', { step: 0.5, decimals: 2 });
      selectField(line, 'Estilo', node, 'Frame.Style', FRAME_STYLE_OPTIONS, 'fsSolid');
      boolField(line, 'Diagonal', node, 'Diagonal', false);
    }

    if (node.name === 'TfrxShapeView' || node.name === 'TfrxRoundRectView') {
      const shape = group('Forma');
      selectField(shape, 'Tipo', node, 'Shape', SHAPES, 'skRectangle');
      numberField(shape, 'Curvatura', node, 'Curve', { step: 1 });
    }

    if (node.name === 'TfrxPictureView') {
      const picture = group('Imagem');
      boolField(picture, 'Transparente', node, 'Transparent', false);
      colorField(picture, 'Cor transparente', node, 'TransparentColor', { fallback: 16777215 });
      boolField(picture, 'Esticar', node, 'Stretched', true);
      boolField(picture, 'Manter proporcao', node, 'KeepAspectRatio', true);
      boolField(picture, 'Centralizar', node, 'Center', false);
      boolField(picture, 'Alta qualidade', node, 'HightQuality', false);
      const tools = actions(picture);
      button(tools, 'Trocar imagem…', () => pickImage(node));
      button(tools, 'Remover imagem', () => {
        store.mutate(() => {
          invalidatePicture(node);
          doc.setStr(node, 'Picture.PropData', null);
        });
      }, 'mini-btn danger');
    }

    if (node.name !== 'TfrxLineView') {
      appendFrameGroup(doc, node, { fill: true });
    }

    const tools = actions(group('Acoes'));
    button(tools, 'Duplicar', () => {
      store.mutate(() => {
        const copy = doc.duplicate(node);
        store.selection = [copy];
      });
    });
    button(tools, 'Trazer para frente', () => store.mutate(() => doc.reorder(node, 'front')));
    button(tools, 'Enviar para tras', () => store.mutate(() => doc.reorder(node, 'back')));
    button(tools, 'Excluir', () => {
      store.mutate(() => {
        doc.remove(node);
        store.selection = [];
      });
    }, 'mini-btn danger');
  }

  function appendFontGroup(doc, node) {
    const font = group('Fonte');
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.setAttribute('list', 'fontList');
    nameInput.value = doc.str(node, 'Font.Name', 'Arial');
    nameInput.addEventListener('change', () => {
      commit(() => doc.setStr(node, 'Font.Name', nameInput.value));
    });
    row(font, 'Familia', nameInput);
    ensureFontList();

    const sizeInput = document.createElement('input');
    sizeInput.type = 'number';
    sizeInput.step = '0.5';
    sizeInput.value = String(fontHeightToPt(doc.str(node, 'Font.Height', '-13')));
    sizeInput.addEventListener('change', () => {
      commit(() => doc.setStr(node, 'Font.Height', String(ptToFontHeight(sizeInput.value))));
    });
    row(font, 'Tamanho (pt)', sizeInput);

    flagsField(font, 'Estilo', node, 'Font.Style', [
      [FONT_STYLE.bold, 'N'],
      [FONT_STYLE.italic, 'I'],
      [FONT_STYLE.underline, 'S'],
      [FONT_STYLE.strikeout, 'T'],
    ]);
    colorField(font, 'Cor', node, 'Font.Color');
  }

  function appendFrameGroup(doc, node, { fill } = {}) {
    const frame = group('Moldura', false);
    flagsField(frame, 'Bordas', node, 'Frame.Typ', [
      [FRAME_BITS.left, 'E'],
      [FRAME_BITS.top, 'T'],
      [FRAME_BITS.right, 'D'],
      [FRAME_BITS.bottom, 'B'],
    ]);
    const all = actions(frame);
    button(all, 'Todas', () => store.mutate(() => doc.setNum(node, 'Frame.Typ', 15, 0)));
    button(all, 'Nenhuma', () => store.mutate(() => doc.setNum(node, 'Frame.Typ', 0, 0)));
    numberField(frame, 'Espessura', node, 'Frame.Width', { step: 0.5, decimals: 2 });
    selectField(frame, 'Estilo', node, 'Frame.Style', FRAME_STYLE_OPTIONS, 'fsSolid');
    colorField(frame, 'Cor da borda', node, 'Frame.Color');
    if (fill) colorField(frame, 'Preenchimento', node, 'Color', { allowNone: true, fallback: -1 });
  }

  function renderMultiple(doc, selection) {
    const info = group('Selecao');
    row(info, 'Objetos', staticText(String(selection.length)));

    const geometry = group('Aplicar a todos');
    const applyRow = actions(geometry);
    for (const [attr, label] of [['Width', 'Mesma largura'], ['Height', 'Mesma altura']]) {
      button(applyRow, label, () => {
        store.mutate(() => {
          const value = doc.num(selection[0], attr);
          for (const node of selection) doc.setNum(node, attr, value);
        });
      });
    }

    appendBulkField(geometry, doc, selection, 'Left', 'Esquerda');
    appendBulkField(geometry, doc, selection, 'Top', 'Topo');
    appendBulkField(geometry, doc, selection, 'Width', 'Largura');
    appendBulkField(geometry, doc, selection, 'Height', 'Altura');

    const style = group('Estilo');
    const styleRow = actions(style);
    button(styleRow, 'Copiar estilo do 1º', () => {
      store.mutate(() => {
        const source = selection[0];
        const keys = ['Font.Name', 'Font.Height', 'Font.Style', 'Font.Color', 'Font.Charset', 'Color', 'Frame.Typ', 'Frame.Width', 'Frame.Color', 'Frame.Style', 'HAlign', 'VAlign'];
        for (const node of selection.slice(1)) {
          for (const key of keys) {
            if (doc.has(source, key)) doc.setStr(node, key, doc.str(source, key));
          }
        }
      });
    });

    const tools = actions(group('Acoes'));
    button(tools, 'Duplicar', () => {
      store.mutate(() => {
        store.selection = selection.map((node) => doc.duplicate(node));
      });
    });
    button(tools, 'Excluir', () => {
      store.mutate(() => {
        for (const node of selection) doc.remove(node);
        store.selection = [];
      });
    }, 'mini-btn danger');
  }

  function appendBulkField(parent, doc, selection, attr, label) {
    const input = document.createElement('input');
    input.type = 'number';
    input.step = store.unit === 'mm' ? '0.1' : '1';
    input.placeholder = 'aplicar…';
    input.addEventListener('change', () => {
      if (input.value === '') return;
      const value = Number(input.value.replace(',', '.')) || 0;
      const asPx = store.unit === 'mm' ? mmToPx(value) : value;
      commit(() => {
        for (const node of selection) doc.setNum(node, attr, asPx);
      });
    });
    row(parent, `${label} (${store.unit})`, input);
  }

  function ensureFontList() {
    if (document.getElementById('fontList')) return;
    const list = document.createElement('datalist');
    list.id = 'fontList';
    for (const font of FONTS) {
      const option = document.createElement('option');
      option.value = font;
      list.appendChild(option);
    }
    document.body.appendChild(list);
  }

  /** Troca a figura de um TfrxPictureView convertendo para BMP 24 bits. */
  function pickImage(node) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0);
      const bmp = imageDataToBmp(ctx.getImageData(0, 0, canvas.width, canvas.height));
      store.mutate(() => {
        invalidatePicture(node);
        store.doc.setStr(node, 'Picture.PropData', bmpToPropData(bmp));
      });
    });
    input.click();
  }

  function round(value, decimals) {
    const factor = 10 ** decimals;
    return String(Math.round(value * factor) / factor);
  }

  return { render };
}
