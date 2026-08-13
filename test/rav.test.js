import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RavDocument,
  encodeDual,
  encodeExtended,
  decodeExtended,
  isRavFile,
  INCH_TO_MM,
  TAG,
} from '../src/core/rav.js';

/* --------------------------- fixture sintetica ---------------------------- */

const bytes = (...parts) => {
  const list = parts.flatMap((part) =>
    typeof part === 'number' ? [part] : Array.from(part)
  );
  return new Uint8Array(list);
};

/** Monta um .rav minimo com um objeto de texto dentro de uma pagina. */
function buildSample({ text = 'Ola mundo', left = 1.5 } = {}) {
  return bytes(
    0x52, 0x41, 0x56, 0x1a, // "RAV\x1A"
    0x01, 0x00, 0x00, 0x00, // cabecalho qualquer
    encodeDual('TRavePage'), encodeDual('Pagina1'), TAG.OBJECT,
    encodeDual('TRaveText'), encodeDual('Titulo'), TAG.OBJECT,
    encodeDual('Text'), TAG.STRING, encodeDual(text),
    encodeDual('Left'), TAG.EXTENDED, encodeExtended(left),
    encodeDual('Top'), TAG.EXTENDED, encodeExtended(2),
    encodeDual('Width'), TAG.EXTENDED, encodeExtended(3),
    encodeDual('Height'), TAG.EXTENDED, encodeExtended(0.25),
    encodeDual('Size'), TAG.INT8, 10,
    encodeDual('Visible'), TAG.IDENT, encodeDual('True'),
  );
}

/* ---------------------------------- testes -------------------------------- */

test('reconhece a assinatura do formato', () => {
  assert.equal(isRavFile(buildSample()), true);
  assert.equal(isRavFile(new Uint8Array([0x3c, 0x3f, 0x78, 0x6d])), false);
  assert.throws(() => new RavDocument(new Uint8Array([1, 2, 3, 4])), /assinatura RAV/);
});

test('Extended de 80 bits vai e volta', () => {
  for (const value of [0, 1, 2.5, 8.26772, -3.75, 0.0625, 1234.5678]) {
    const decoded = decodeExtended(encodeExtended(value));
    assert.ok(Math.abs(decoded - value) < 1e-9, `${value} -> ${decoded}`);
  }
});

test('string dupla grava UTF-16 e ANSI, com escape acima de 127 bytes', () => {
  const curta = encodeDual('abc');
  // marcador(4) + len(1) + utf16(6) + len(1) + ansi(3)
  assert.equal(curta.length, 15);
  assert.equal(curta[4], 6);

  const longa = encodeDual('x'.repeat(100));
  // 200 bytes de UTF-16 nao cabem em um byte: escape 0x80 + tamanho
  assert.equal(longa[4], 0x80);
  assert.equal(longa[5], 200);

  const doc = new RavDocument(buildSample({ text: 'y'.repeat(300) }));
  assert.equal(doc.property(doc.objects[1], 'Text').value, 'y'.repeat(300));
});

test('le a estrutura: objetos, nomes e propriedades', () => {
  const doc = new RavDocument(buildSample());
  assert.deepEqual(doc.objects.map((object) => object.className), ['TRavePage', 'TRaveText']);

  const texto = doc.objects[1];
  assert.equal(texto.name, 'Titulo');
  assert.equal(doc.property(texto, 'Text').value, 'Ola mundo');
  assert.equal(doc.property(texto, 'Size').value, 10);
  assert.equal(doc.property(texto, 'Visible').value, 'True');
  assert.equal(doc.displayText(texto), 'Ola mundo');

  const rect = doc.rectMm(texto);
  assert.ok(Math.abs(rect.left - 1.5 * INCH_TO_MM) < 1e-6);
  assert.ok(Math.abs(rect.width - 3 * INCH_TO_MM) < 1e-6);
});

test('agrupa objetos por pagina', () => {
  const doc = new RavDocument(buildSample());
  const paginas = doc.outline().flatMap((report) => report.pages);
  assert.equal(paginas.length, 1);
  assert.equal(paginas[0].name, 'Pagina1');
  assert.deepEqual(paginas[0].items.map((item) => item.name), ['Titulo']);
});

test('salvar sem editar devolve exatamente os mesmos bytes', () => {
  const original = buildSample();
  const doc = new RavDocument(original);
  assert.deepEqual(doc.serialize(), original);
});

test('editar medida mantem o tamanho do arquivo e so muda o valor', () => {
  const original = buildSample();
  const doc = new RavDocument(original);
  const left = doc.property(doc.objects[1], 'Left');
  const start = left.valueStart;

  doc.setValue(left, 4.25);
  const saved = doc.serialize();

  assert.equal(saved.length, original.length, 'Extended tem tamanho fixo');
  assert.deepEqual(saved.subarray(0, start), original.subarray(0, start));
  assert.deepEqual(saved.subarray(start + 10), original.subarray(start + 10));
  assert.equal(decodeExtended(saved, start), 4.25);
});

test('editar texto reescreve so o trecho do valor', () => {
  const original = buildSample({ text: 'antigo' });
  const doc = new RavDocument(original);
  const property = doc.property(doc.objects[1], 'Text');
  const start = property.valueStart;

  doc.setValue(property, 'um texto bem maior');
  const saved = doc.serialize();

  assert.deepEqual(saved.subarray(0, start), original.subarray(0, start));
  assert.notEqual(saved.length, original.length);

  const reparsed = new RavDocument(saved);
  assert.equal(reparsed.property(reparsed.objects[1], 'Text').value, 'um texto bem maior');
  // o resto das propriedades continua legivel depois do deslocamento
  assert.equal(reparsed.property(reparsed.objects[1], 'Size').value, 10);
  assert.equal(decodeExtended(saved, reparsed.property(reparsed.objects[1], 'Left').valueStart), 1.5);
});

test('desfazer restaura o arquivo byte a byte', () => {
  const original = buildSample();
  const doc = new RavDocument(original);

  const patch = doc.setValue(doc.property(doc.objects[1], 'Text'), 'outro valor qualquer');
  assert.notDeepEqual(doc.serialize(), original);

  doc.applyPatch(patch);
  assert.deepEqual(doc.serialize(), original);
});

test('propriedades de tipo desconhecido ficam bloqueadas para edicao', () => {
  const file = bytes(
    0x52, 0x41, 0x56, 0x1a,
    encodeDual('TRaveBitmap'), encodeDual('Logo'), TAG.OBJECT,
    encodeDual('Image'), TAG.BINARY, 0x00, 0x01, 0x02,
    encodeDual('Name'), TAG.STRING, encodeDual('Logo'),
  );
  const doc = new RavDocument(file);
  const image = doc.property(doc.objects[0], 'Image');
  assert.equal(image.editable, false);
  assert.equal(doc.setValue(image, 'x'), false);
  assert.deepEqual(doc.serialize(), file);
});

test('entradas do dicionario de classes ficam fora do relatorio', () => {
  const file = bytes(
    0x52, 0x41, 0x56, 0x1a,
    encodeDual('TRaveComponent'), encodeDual('TRaveComponent.GetName'), TAG.OBJECT,
    encodeDual('TRavePage'), encodeDual('Pagina1'), TAG.OBJECT,
  );
  const doc = new RavDocument(file);
  assert.equal(doc.objects.length, 2);
  assert.deepEqual(doc.reportObjects.map((object) => object.name), ['Pagina1']);
});
