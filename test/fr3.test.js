import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Fr3Document } from '../src/core/fr3.js';
import { parseDocument, serialize, getAttr, setAttr, childElements } from '../src/core/xml.js';
import { colorToCss, cssToColor, mmToPx, pxToMm, fontHeightToPt, ptToFontHeight } from '../src/core/units.js';
import { decodePropData, imageDataToBmp, bmpToPropData } from '../src/core/picture.js';

const SAMPLE = fileURLToPath(new URL('../samples/rsiamac_1.fr3', import.meta.url));
const sampleText = readFileSync(SAMPLE, 'utf8');

test('round-trip preserva o arquivo byte a byte', () => {
  const doc = new Fr3Document(sampleText);
  assert.equal(doc.serialize(), sampleText);
});

test('round-trip apos editar um objeto muda apenas o atributo tocado', () => {
  const doc = new Fr3Document(sampleText);
  const memo = doc.findByName('pesoLiquido');
  assert.ok(memo, 'memo de exemplo encontrado');
  doc.setNum(memo, 'Left', 100);

  const before = sampleText.split('\n');
  const after = doc.serialize().split('\n');
  assert.equal(before.length, after.length);
  const changed = before.filter((line, i) => line !== after[i]);
  assert.equal(changed.length, 1);
  assert.match(after.find((line, i) => line !== before[i]), /Left="100"/);
});

test('entidades sao decodificadas e reescritas no estilo FastReport', () => {
  const doc = new Fr3Document(sampleText);
  const memo = doc.findByName('frxDBDataset1fator_de_correcao_utilizado');
  assert.equal(doc.str(memo, 'Text'), '[frxDBDataset1."fator_de_correcao_utilizado"]');

  doc.setStr(memo, 'Text', 'linha 1\r\nlinha "2"');
  assert.match(doc.serialize(), /Text="linha 1&#13;&#10;linha &#34;2&#34;"/);
});

test('estrutura do relatorio e lida corretamente', () => {
  const doc = new Fr3Document(sampleText);
  assert.equal(doc.pages.length, 1);
  const page = doc.pages[0];
  const bands = doc.orderedBands(page);
  assert.deepEqual(bands.map((b) => b.name), ['TfrxReportTitle', 'TfrxMasterData', 'TfrxPageFooter']);
  assert.equal(doc.objectsOf(bands[0]).length, 72);
  // Memo50 esta ancorado direto na pagina, fora de qualquer banda.
  assert.deepEqual(doc.objectsOf(page).map((o) => doc.str(o, 'Name')), ['Memo50']);
  assert.equal(doc.variables().length, 353);
  assert.deepEqual(doc.datasets().map((d) => d.name), ['frxDBDataset1']);
});

test('geometria da pagina converte mm para px', () => {
  const doc = new Fr3Document(sampleText);
  const geo = doc.pageGeometry(doc.pages[0]);
  assert.equal(geo.paperWidth, 85);
  assert.ok(Math.abs(geo.width - mmToPx(85)) < 1e-9);
  // largura util = 85 - 10 - 10 mm, que e a largura das bandas do arquivo
  assert.ok(Math.abs(doc.contentWidth(doc.pages[0]) - 245.66929) < 0.01);
});

test('inserir, duplicar e remover objetos mantem o XML valido', () => {
  const doc = new Fr3Document(sampleText);
  const band = doc.orderedBands(doc.pages[0])[0];
  const before = doc.objectsOf(band).length;

  const memo = doc.addObject(band, 'TfrxMemoView', { Text: 'Novo' });
  assert.equal(doc.objectsOf(band).length, before + 1);
  assert.match(doc.serialize(), /<TfrxMemoView Name="Memo\d+"[^>]*Text="Novo"\/>/);

  const copy = doc.duplicate(memo);
  assert.notEqual(doc.str(copy, 'Name'), doc.str(memo, 'Name'));
  assert.equal(doc.num(copy, 'Left'), doc.num(memo, 'Left') + 9.44882);

  doc.remove(copy);
  doc.remove(memo);
  assert.equal(doc.objectsOf(band).length, before);
  // sem o objeto extra o arquivo volta a ser identico ao original
  assert.equal(doc.serialize(), sampleText);
});

test('redimensionar banda empurra as bandas seguintes', () => {
  const doc = new Fr3Document(sampleText);
  const [title, master, footer] = doc.orderedBands(doc.pages[0]);
  const masterTop = doc.num(master, 'Top');
  const footerTop = doc.num(footer, 'Top');

  doc.resizeBand(title, doc.num(title, 'Height') + 50);
  assert.equal(doc.num(master, 'Top'), masterTop + 50);
  assert.equal(doc.num(footer, 'Top'), footerTop + 50);
});

test('mover objeto entre bandas preserva a posicao absoluta', () => {
  const doc = new Fr3Document(sampleText);
  const [title, master] = doc.orderedBands(doc.pages[0]);
  const memo = doc.objectsOf(title)[0];
  const absolute = doc.num(title, 'Top') + doc.num(memo, 'Top');

  doc.reparent(memo, master);
  assert.equal(memo.parent, master);
  assert.ok(Math.abs(doc.num(master, 'Top') + doc.num(memo, 'Top') - absolute) < 0.001);
});

test('variaveis podem ser criadas e removidas', () => {
  const doc = new Fr3Document(sampleText);
  const total = doc.variables().length;
  doc.addVariable('minha_variavel');
  assert.equal(doc.variables().length, total + 1);
  assert.match(doc.serialize(), /<item Name="minha_variavel"\/>/);
  doc.remove(doc.variables().at(-1).node);
  assert.equal(doc.serialize(), sampleText);
});

test('expressoes usadas no layout sao listadas', () => {
  const doc = new Fr3Document(sampleText);
  const expressions = doc.expressions();
  assert.ok(expressions.includes('peso_do_desconto'));
  assert.ok(expressions.includes('frxDBDataset1."fator_de_correcao_utilizado"'));
});

test('relatorio em branco e valido e editavel', () => {
  const doc = Fr3Document.blank();
  assert.equal(doc.pages.length, 1);
  const band = doc.orderedBands(doc.pages[0])[0];
  doc.addObject(band, 'TfrxMemoView', { Text: 'Ola' });
  const reparsed = new Fr3Document(doc.serialize());
  assert.equal(reparsed.objectsOf(reparsed.orderedBands(reparsed.pages[0])[0]).length, 1);
});

test('cores TColor (BGR) convertem nos dois sentidos', () => {
  assert.equal(colorToCss(0), '#000000');
  assert.equal(colorToCss(16777215), '#ffffff');
  assert.equal(colorToCss(16711680), '#0000ff'); // clBlue no Delphi
  assert.equal(cssToColor('#0000ff'), 16711680);
  assert.equal(cssToColor(colorToCss(1234567)), 1234567);
  assert.equal(colorToCss(536870911), null); // clNone
});

test('altura de fonte do Delphi vira pontos e volta', () => {
  assert.equal(fontHeightToPt('-11'), 8.3);
  assert.equal(ptToFontHeight(8.25), -11);
  assert.ok(Math.abs(pxToMm(mmToPx(37.5)) - 37.5) < 1e-9);
});

test('imagem embutida e extraida do PropData', () => {
  const doc = new Fr3Document(sampleText);
  const picture = doc.findByName('Picture1');
  const image = decodePropData(doc.str(picture, 'Picture.PropData'));
  assert.equal(image.mime, 'image/bmp');
  // header BMP: tamanho declarado bate com o numero de bytes extraidos
  const declared = image.bytes[2] | (image.bytes[3] << 8) | (image.bytes[4] << 16) | (image.bytes[5] << 24);
  assert.equal(declared, image.bytes.length);
});

test('nova imagem pode ser codificada de volta em PropData', () => {
  const width = 3;
  const height = 2;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const bmp = imageDataToBmp({ width, height, data });
  const propData = bmpToPropData(bmp);
  assert.match(propData, /^0444617461/); // 04 + "Data"
  const decoded = decodePropData(propData);
  assert.equal(decoded.mime, 'image/bmp');
  assert.equal(decoded.bytes.length, bmp.length);
});

test('parser generico preserva comentarios, CDATA e prolog', () => {
  const xml = '<?xml version="1.0"?>\r\n<!-- nota -->\r\n<root a="1" b=\'2\'>\r\n  <child/>\r\n  <![CDATA[x < y]]>\r\n</root>\r\n';
  const doc = parseDocument(xml);
  assert.equal(serialize(doc), xml);
  const root = childElements(doc, 'root')[0];
  assert.equal(getAttr(root, 'b'), '2');
  setAttr(root, 'c', 'x&y');
  assert.match(serialize(doc), /c="x&amp;y"/);
});
