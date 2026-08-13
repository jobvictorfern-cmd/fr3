/**
 * Modelo de documento FR3 sobre o parser XML cru.
 *
 * A classe nao copia os dados para uma estrutura propria: ela opera direto nos
 * nos do XML. Assim qualquer propriedade que a interface nao conhece continua
 * intacta no arquivo salvo.
 */

import {
  parseDocument,
  serialize,
  childElements,
  firstChild,
  getAttr,
  setAttr,
  hasAttr,
  createElement,
  cloneNode,
  appendChild,
  removeChild,
  walk,
} from './xml.js';
import { formatNumber, parseNumber, mmToPx, pxToMm } from './units.js';

export const BAND_TAGS = [
  'TfrxReportTitle',
  'TfrxReportSummary',
  'TfrxPageHeader',
  'TfrxPageFooter',
  'TfrxHeader',
  'TfrxFooter',
  'TfrxColumnHeader',
  'TfrxColumnFooter',
  'TfrxMasterData',
  'TfrxDetailData',
  'TfrxSubdetailData',
  'TfrxDataBand4',
  'TfrxDataBand5',
  'TfrxDataBand6',
  'TfrxGroupHeader',
  'TfrxGroupFooter',
  'TfrxChild',
  'TfrxOverlay',
];

export const OBJECT_TAGS = [
  'TfrxMemoView',
  'TfrxLineView',
  'TfrxPictureView',
  'TfrxShapeView',
  'TfrxRoundRectView',
  'TfrxBarCodeView',
  'TfrxRichView',
  'TfrxCheckBoxView',
  'TfrxSubreport',
  'TfrxChartView',
  'TfrxGradientView',
];

export const BAND_LABELS = {
  TfrxReportTitle: 'Titulo do relatorio',
  TfrxReportSummary: 'Resumo do relatorio',
  TfrxPageHeader: 'Cabecalho da pagina',
  TfrxPageFooter: 'Rodape da pagina',
  TfrxHeader: 'Cabecalho',
  TfrxFooter: 'Rodape',
  TfrxColumnHeader: 'Cabecalho de coluna',
  TfrxColumnFooter: 'Rodape de coluna',
  TfrxMasterData: 'Dados mestre',
  TfrxDetailData: 'Dados detalhe',
  TfrxSubdetailData: 'Subdetalhe',
  TfrxDataBand4: 'Dados 4',
  TfrxDataBand5: 'Dados 5',
  TfrxDataBand6: 'Dados 6',
  TfrxGroupHeader: 'Cabecalho de grupo',
  TfrxGroupFooter: 'Rodape de grupo',
  TfrxChild: 'Banda filha',
  TfrxOverlay: 'Sobreposicao',
};

export const OBJECT_LABELS = {
  TfrxMemoView: 'Texto',
  TfrxLineView: 'Linha',
  TfrxPictureView: 'Imagem',
  TfrxShapeView: 'Forma',
  TfrxRoundRectView: 'Retangulo arredondado',
  TfrxBarCodeView: 'Codigo de barras',
  TfrxRichView: 'Texto rico',
  TfrxCheckBoxView: 'Caixa de selecao',
  TfrxSubreport: 'Sub-relatorio',
  TfrxChartView: 'Grafico',
  TfrxGradientView: 'Degrade',
};

const BAND_SET = new Set(BAND_TAGS);
const OBJECT_SET = new Set(OBJECT_TAGS);

export const isBand = (node) => !!node && BAND_SET.has(node.name);
export const isObject = (node) => !!node && OBJECT_SET.has(node.name);
export const isPage = (node) => !!node && node.name === 'TfrxReportPage';

const BLANK_REPORT = `<?xml version="1.0" encoding="utf-8" standalone="no"?>\r
<TfrxReport Version="6.9.12" DotMatrixReport="False" IniFile="\\Software\\Fast Reports" PreviewOptions.Buttons="167935" PreviewOptions.Zoom="1" PrintOptions.Printer="Default" PrintOptions.PrintOnSheet="0" ReportOptions.Description.Text="" ScriptLanguage="PascalScript" ScriptText.Text="begin&#13;&#10;&#13;&#10;end.">\r
  <Datasets/>\r
  <Variables/>\r
  <TfrxDataPage Name="Data" Height="1000" Left="0" Top="0" Width="1000"/>\r
  <TfrxReportPage Name="Page1" Font.Charset="1" Font.Color="0" Font.Height="-13" Font.Name="Arial" Font.Style="0" PaperWidth="210" PaperHeight="297" PaperSize="9" LeftMargin="10" RightMargin="10" TopMargin="10" BottomMargin="10" ColumnWidth="0" ColumnPositions.Text="" Frame.Typ="0" MirrorMode="0">\r
    <TfrxReportTitle Name="ReportTitle1" FillType="ftBrush" Frame.Typ="0" Height="75.59055" Left="0" Top="18.89765" Width="718.11024"/>\r
    <TfrxMasterData Name="MasterData1" FillType="ftBrush" Frame.Typ="0" Height="37.79527" Left="0" Top="132.28348" Width="718.11024" ColumnWidth="0" ColumnGap="0" RowCount="0"/>\r
  </TfrxReportPage>\r
</TfrxReport>\r
`;

export class Fr3Document {
  /** @param {string} text conteudo XML do .fr3 */
  constructor(text) {
    this.xml = parseDocument(text);
    this.report = childElements(this.xml, 'TfrxReport')[0] || null;
    if (!this.report) {
      throw new Error('Arquivo invalido: elemento <TfrxReport> nao encontrado.');
    }
  }

  static blank() {
    return new Fr3Document(BLANK_REPORT);
  }

  serialize() {
    return serialize(this.xml);
  }

  clone() {
    return new Fr3Document(this.serialize());
  }

  /* --------------------------------- acesso -------------------------------- */

  get pages() {
    return childElements(this.report, 'TfrxReportPage');
  }

  get dataPages() {
    return childElements(this.report, 'TfrxDataPage');
  }

  bands(page) {
    return childElements(page).filter(isBand);
  }

  /** Objetos filhos diretos de uma banda ou da propria pagina. */
  objectsOf(parent) {
    return childElements(parent).filter(isObject);
  }

  /** Todos os containers de objetos de uma pagina (bandas + a pagina). */
  containers(page) {
    return [...this.bands(page), page];
  }

  findByName(name) {
    for (const node of walk(this.report)) {
      if (getAttr(node, 'Name') === name) return node;
    }
    return null;
  }

  /** Caminho de indices ate um no — usado para reencontra-lo apos undo/redo. */
  pathOf(node) {
    const path = [];
    let current = node;
    while (current && current !== this.xml) {
      const parent = current.parent;
      if (!parent) break;
      path.unshift(parent.children.indexOf(current));
      current = parent;
    }
    return path;
  }

  nodeAtPath(path) {
    let node = this.xml;
    for (const index of path) {
      node = node?.children?.[index];
      if (!node) return null;
    }
    return node;
  }

  /* ------------------------------- atributos ------------------------------- */

  str(node, name, fallback = '') {
    return getAttr(node, name, fallback);
  }

  setStr(node, name, value) {
    setAttr(node, name, value === '' || value === null ? value : String(value));
  }

  num(node, name, fallback = 0) {
    return parseNumber(getAttr(node, name, null), fallback);
  }

  setNum(node, name, value, decimals = 5) {
    setAttr(node, name, formatNumber(value, decimals));
  }

  bool(node, name, fallback = false) {
    const value = getAttr(node, name, null);
    if (value === null) return fallback;
    return String(value).toLowerCase() === 'true';
  }

  setBool(node, name, value) {
    setAttr(node, name, value ? 'True' : 'False');
  }

  has(node, name) {
    return hasAttr(node, name);
  }

  /* -------------------------------- geometria ------------------------------ */

  /** Retangulo do objeto em px, relativo ao pai. */
  rect(node) {
    return {
      left: this.num(node, 'Left'),
      top: this.num(node, 'Top'),
      width: this.num(node, 'Width'),
      height: this.num(node, 'Height'),
    };
  }

  setRect(node, rect) {
    if (rect.left !== undefined) this.setNum(node, 'Left', rect.left);
    if (rect.top !== undefined) this.setNum(node, 'Top', rect.top);
    if (rect.width !== undefined) this.setNum(node, 'Width', Math.max(0, rect.width));
    if (rect.height !== undefined) this.setNum(node, 'Height', Math.max(0, rect.height));
  }

  /** Geometria da pagina, ja convertida para px. */
  pageGeometry(page) {
    const paperWidth = this.num(page, 'PaperWidth', 210);
    const paperHeight = this.num(page, 'PaperHeight', 297);
    return {
      paperWidth,
      paperHeight,
      width: mmToPx(paperWidth),
      height: mmToPx(paperHeight),
      left: mmToPx(this.num(page, 'LeftMargin', 10)),
      right: mmToPx(this.num(page, 'RightMargin', 10)),
      top: mmToPx(this.num(page, 'TopMargin', 10)),
      bottom: mmToPx(this.num(page, 'BottomMargin', 10)),
      get contentWidth() {
        return this.width - this.left - this.right;
      },
    };
  }

  /** Largura util da pagina em px (area entre as margens). */
  contentWidth(page) {
    const geo = this.pageGeometry(page);
    return geo.width - geo.left - geo.right;
  }

  /** Bandas ordenadas pelo Top gravado no arquivo (ordem do designer). */
  orderedBands(page) {
    return this.bands(page).sort((a, b) => this.num(a, 'Top') - this.num(b, 'Top'));
  }

  /**
   * Altera a altura de uma banda deslocando as bandas seguintes, preservando
   * os espacos que o designer do FastReport mantem entre elas.
   */
  resizeBand(band, height) {
    const page = band.parent;
    const current = this.num(band, 'Height');
    const next = Math.max(0, height);
    const delta = next - current;
    if (!delta) return;
    this.setNum(band, 'Height', next);
    const top = this.num(band, 'Top');
    for (const other of this.bands(page)) {
      if (other === band) continue;
      const otherTop = this.num(other, 'Top');
      if (otherTop > top) this.setNum(other, 'Top', otherTop + delta);
    }
  }

  /* --------------------------- criacao / remocao --------------------------- */

  /** Gera um nome livre no formato usado pelo FastReport (Memo12, Line3...). */
  uniqueName(prefix) {
    const used = new Set();
    for (const node of walk(this.report)) {
      const name = getAttr(node, 'Name');
      if (name) used.add(name);
    }
    let index = 1;
    while (used.has(prefix + index)) index++;
    return prefix + index;
  }

  namePrefix(tag) {
    const base = tag.replace(/^Tfrx/, '').replace(/View$/, '');
    return base;
  }

  /** Cria um objeto dentro de uma banda/pagina. */
  addObject(parent, tag, props = {}) {
    const name = props.Name || this.uniqueName(this.namePrefix(tag));
    const defaults = objectDefaults(tag);
    const node = createElement(tag, { Name: name, ...defaults, ...props });
    appendChild(parent, node);
    return node;
  }

  /** Cria uma banda na pagina, empilhada apos a ultima existente. */
  addBand(page, tag, height = 75.59055) {
    const bands = this.orderedBands(page);
    const last = bands[bands.length - 1];
    const top = last ? this.num(last, 'Top') + this.num(last, 'Height') + 42 : 18.89765;
    const node = createElement(tag, {
      Name: this.uniqueName(tag.replace(/^Tfrx/, '')),
      FillType: 'ftBrush',
      'Frame.Typ': '0',
      Height: formatNumber(height),
      Left: '0',
      Top: formatNumber(top),
      Width: formatNumber(this.contentWidth(page)),
    });
    if (tag === 'TfrxMasterData') {
      setAttr(node, 'ColumnWidth', '0');
      setAttr(node, 'ColumnGap', '0');
      setAttr(node, 'RowCount', '0');
    }
    appendChild(page, node);
    return node;
  }

  /** Quantas vezes um nome aparece no relatorio. */
  countName(name) {
    let total = 0;
    for (const node of walk(this.report)) {
      if (getAttr(node, 'Name') === name) total++;
    }
    return total;
  }

  /**
   * Insere um objeto ja montado (ex.: colado da area de transferencia),
   * renomeando-o apenas se o nome colidir com outro do relatorio.
   */
  insertObjectNode(parent, node) {
    appendChild(parent, node);
    const name = getAttr(node, 'Name');
    if (!name || this.countName(name) > 1) {
      setAttr(node, 'Name', this.uniqueName(this.namePrefix(node.name)));
    }
    return node;
  }

  /** Copia um objeto no mesmo pai, deslocado alguns pixels. */
  duplicate(node) {
    const copy = cloneNode(node);
    setAttr(copy, 'Name', this.uniqueName(this.namePrefix(node.name)));
    setAttr(copy, 'Left', formatNumber(this.num(node, 'Left') + 9.44882));
    setAttr(copy, 'Top', formatNumber(this.num(node, 'Top') + 9.44882));
    appendChild(node.parent, copy);
    return copy;
  }

  remove(node) {
    return removeChild(node);
  }

  /** Move o objeto para outro container mantendo a posicao absoluta na pagina. */
  reparent(node, newParent) {
    if (node.parent === newParent) return;
    const oldParent = node.parent;
    const offsetTop = isBand(oldParent) ? this.num(oldParent, 'Top') : 0;
    const newOffset = isBand(newParent) ? this.num(newParent, 'Top') : 0;
    const top = this.num(node, 'Top') + offsetTop - newOffset;
    removeChild(node);
    setAttr(node, 'Top', formatNumber(top));
    appendChild(newParent, node);
  }

  /** Envia para frente/tras alterando a ordem entre os irmaos. */
  reorder(node, direction) {
    const parent = node.parent;
    if (!parent) return;
    const siblings = childElements(parent).filter(isObject);
    const index = siblings.indexOf(node);
    const target = direction === 'front' ? siblings.length - 1
      : direction === 'back' ? 0
      : index + (direction === 'up' ? 1 : -1);
    if (index === -1 || target === index || target < 0 || target > siblings.length - 1) return;
    const reordered = siblings.slice();
    reordered.splice(index, 1);
    reordered.splice(target, 0, node);
    // Reescreve os elementos nas posicoes originais, preservando o whitespace.
    const slots = [];
    parent.children.forEach((child, i) => {
      if (child.type === 'element' && isObject(child)) slots.push(i);
    });
    slots.forEach((slot, i) => {
      parent.children[slot] = reordered[i];
    });
  }

  /* -------------------------- variaveis e datasets ------------------------- */

  get variablesNode() {
    return firstChild(this.report, 'Variables');
  }

  get datasetsNode() {
    return firstChild(this.report, 'Datasets');
  }

  variables() {
    const node = this.variablesNode;
    if (!node) return [];
    return childElements(node, 'item').map((item) => ({ node: item, name: getAttr(item, 'Name', '') }));
  }

  addVariable(name) {
    let node = this.variablesNode;
    if (!node) {
      node = createElement('Variables');
      node.selfClosing = false;
      appendChild(this.report, node);
    }
    return appendChild(node, createElement('item', { Name: name }));
  }

  datasets() {
    const node = this.datasetsNode;
    if (!node) return [];
    return childElements(node, 'item').map((item) => ({
      node: item,
      name: getAttr(item, 'DataSetName', ''),
    }));
  }

  /** Todas as expressoes `[...]` usadas nos objetos de texto do relatorio. */
  expressions() {
    const found = new Set();
    for (const node of walk(this.report)) {
      if (node.name !== 'TfrxMemoView') continue;
      const text = getAttr(node, 'Text', '');
      for (const match of text.matchAll(/\[([^[\]]+)\]/g)) {
        found.add(match[1].trim());
      }
    }
    return [...found].sort((a, b) => a.localeCompare(b));
  }
}

/** Atributos minimos para cada tipo de objeto novo. */
function objectDefaults(tag) {
  const common = {
    AllowVectorExport: 'True',
    Left: '0',
    Top: '0',
    Width: formatNumber(mmToPx(40)),
    Height: formatNumber(mmToPx(6)),
    'Frame.Typ': '0',
  };
  switch (tag) {
    case 'TfrxMemoView':
      return {
        ...common,
        'Font.Charset': '1',
        'Font.Color': '0',
        'Font.Height': '-11',
        'Font.Name': 'Arial',
        'Font.Style': '0',
        ParentFont: 'False',
        VAlign: 'vaCenter',
        Text: 'Texto',
      };
    case 'TfrxLineView':
      return { ...common, Height: '0', Color: '0', 'Frame.Typ': '4' };
    case 'TfrxPictureView':
      return {
        ...common,
        Height: formatNumber(mmToPx(20)),
        HightQuality: 'False',
        Transparent: 'False',
        TransparentColor: '16777215',
      };
    case 'TfrxShapeView':
      return { ...common, Height: formatNumber(mmToPx(20)), Shape: 'skRectangle', 'Frame.Typ': '15' };
    case 'TfrxBarCodeView':
      return {
        ...common,
        Height: formatNumber(mmToPx(15)),
        BarType: 'bcCode128',
        Text: '123456',
        Zoom: '1',
      };
    default:
      return common;
  }
}

export { pxToMm, mmToPx };
