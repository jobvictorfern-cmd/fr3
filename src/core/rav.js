/**
 * Leitura e edicao de arquivos .rav (Rave Reports / Nevrona).
 *
 * Ao contrario do .fr3, o .rav e binario e o formato nao e documentado. O que
 * esta implementado aqui foi obtido por engenharia reversa de um projeto real
 * e cobre a parte que interessa para editar um relatorio: nomes de classe,
 * nomes de objeto e propriedades com seus valores.
 *
 * Estrutura observada:
 *
 *   "RAV\x1A" <cabecalho>
 *   ... sequencia de registros ...
 *
 * Todo identificador (classe, propriedade, valor textual) e gravado como uma
 * "string dupla": o marcador BF ED 84 B0, o texto em UTF-16LE precedido do seu
 * tamanho em bytes, e o mesmo texto em ANSI precedido do tamanho em
 * caracteres. Depois do nome de uma propriedade vem um byte de tipo:
 *
 *   0  identificador/enum (o valor e a proxima string dupla)
 *   1  inteiro de 1 byte        2  inteiro de 2 bytes
 *   3  inteiro de 4 bytes       4  inteiro de 8 bytes
 *   5  Extended de 80 bits (coordenadas, em polegadas)
 *   6  texto (string dupla)     7  conjunto (strings duplas ate uma vazia)
 *   8  inicio de objeto aninhado (ex.: Font)
 *   9  bloco binario (imagens)
 *
 * ESTRATEGIA DE EDICAO: o documento guarda os bytes originais e so substitui o
 * trecho exato do valor alterado. Tudo que voce nao editou continua byte a
 * byte igual ao arquivo de origem — a mesma garantia do editor de .fr3.
 */

const MARKER = [0xbf, 0xed, 0x84, 0xb0];
export const RAV_SIGNATURE = [0x52, 0x41, 0x56, 0x1a]; // "RAV\x1A"

export const TAG = {
  IDENT: 0,
  INT8: 1,
  INT16: 2,
  INT32: 3,
  INT64: 4,
  EXTENDED: 5,
  STRING: 6,
  SET: 7,
  OBJECT: 8,
  BINARY: 9,
};

/** Tipos cujo tamanho conhecemos com certeza e que podem ser editados. */
const EDITABLE = new Set([TAG.IDENT, TAG.INT8, TAG.INT16, TAG.INT32, TAG.EXTENDED, TAG.STRING]);

const NUMERIC = new Set([TAG.INT8, TAG.INT16, TAG.INT32, TAG.EXTENDED]);

/**
 * Classes que agrupam outros objetos. No arquivo, os objetos que vem logo
 * depois de um container pertencem a ele, e suas coordenadas sao relativas ao
 * canto do container — nao a pagina.
 */
export const CONTAINER_CLASSES = new Set([
  'TRaveSection',
  'TRaveRegion',
  'TRaveBand',
  'TRaveDataBand',
]);

/** Polegadas -> milimetros: o Rave grava coordenadas em polegadas. */
export const INCH_TO_MM = 25.4;

const latin1 = (bytes) => String.fromCharCode(...bytes);

export function isRavFile(bytes) {
  return RAV_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

/* --------------------------- Extended de 80 bits --------------------------- */

export function decodeExtended(bytes, offset = 0) {
  let mantissa = 0n;
  for (let i = 7; i >= 0; i--) mantissa = (mantissa << 8n) | BigInt(bytes[offset + i]);
  const head = bytes[offset + 8] | (bytes[offset + 9] << 8);
  const sign = head & 0x8000 ? -1 : 1;
  const exponent = head & 0x7fff;
  if (exponent === 0 && mantissa === 0n) return 0;
  return sign * Number(mantissa) * 2 ** (exponent - 16383 - 63);
}

export function encodeExtended(value) {
  const out = new Uint8Array(10);
  if (!Number.isFinite(value) || value === 0) return out;

  const sign = value < 0 ? 0x8000 : 0;
  let magnitude = Math.abs(value);
  let exponent = Math.floor(Math.log2(magnitude));
  let fraction = magnitude / 2 ** exponent;
  // log2 pode errar por um na fronteira das potencias de dois
  if (fraction >= 2) { fraction /= 2; exponent++; }
  if (fraction < 1) { fraction *= 2; exponent--; }

  let mantissa = BigInt(Math.round(fraction * 2 ** 63));
  if (mantissa >= 1n << 64n) { mantissa >>= 1n; exponent++; }

  for (let i = 0; i < 8; i++) out[i] = Number((mantissa >> BigInt(i * 8)) & 0xffn);
  const head = sign | (exponent + 16383);
  out[8] = head & 0xff;
  out[9] = (head >> 8) & 0xff;
  return out;
}

/* ------------------------------ strings duplas ----------------------------- */

/** Bytes extras usados por cada escape de tamanho. */
const LENGTH_ESCAPES = { 0x80: 1, 0x81: 2, 0x82: 4 };

/**
 * Le um tamanho: valores ate 0x7F cabem em um byte; acima disso o byte e um
 * escape (0x80/0x81/0x82) e o tamanho vem nos bytes seguintes, em little-endian.
 */
function readLength(bytes, offset) {
  const head = bytes[offset];
  if (head < 0x80) return { value: head, end: offset + 1 };
  const extra = LENGTH_ESCAPES[head];
  if (!extra) return null;
  let value = 0;
  for (let i = extra - 1; i >= 0; i--) value = value * 256 + bytes[offset + 1 + i];
  return { value, end: offset + 1 + extra };
}

function writeLength(value) {
  if (value < 0x80) return [value];
  if (value <= 0xff) return [0x80, value];
  if (value <= 0xffff) return [0x81, value & 0xff, (value >> 8) & 0xff];
  return [0x82, value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff];
}

/** Le a string dupla que comeca em `offset`, ou null se nao houver marcador. */
function readDual(bytes, offset) {
  for (let i = 0; i < 4; i++) if (bytes[offset + i] !== MARKER[i]) return null;
  const wide = readLength(bytes, offset + 4);
  if (!wide) return null;
  const wideStart = wide.end;
  const ansiHeader = readLength(bytes, wideStart + wide.value);
  if (!ansiHeader) return null;
  const ansiStart = ansiHeader.end;
  const end = ansiStart + ansiHeader.value;
  if (end > bytes.length) return null;

  let text = latin1(bytes.subarray(ansiStart, end));
  if (!ansiHeader.value && wide.value) {
    text = '';
    for (let i = 0; i < wide.value; i += 2) {
      text += String.fromCharCode(bytes[wideStart + i] | (bytes[wideStart + i + 1] << 8));
    }
  }
  return { text, start: offset, end };
}

/** Monta os bytes de uma string dupla (UTF-16LE + ANSI), como o Rave grava. */
export function encodeDual(text) {
  const value = String(text ?? '');
  const wide = new Uint8Array(value.length * 2);
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    wide[i * 2] = code & 0xff;
    wide[i * 2 + 1] = (code >> 8) & 0xff;
  }
  const ansi = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i++) ansi[i] = value.charCodeAt(i) & 0xff;

  const wideHeader = writeLength(wide.length);
  const ansiHeader = writeLength(ansi.length);
  const out = new Uint8Array(
    MARKER.length + wideHeader.length + wide.length + ansiHeader.length + ansi.length
  );
  let p = 0;
  out.set(MARKER, p); p += MARKER.length;
  out.set(wideHeader, p); p += wideHeader.length;
  out.set(wide, p); p += wide.length;
  out.set(ansiHeader, p); p += ansiHeader.length;
  out.set(ansi, p);
  return out;
}

/* -------------------------------- documento -------------------------------- */

export class RavDocument {
  /** @param {Uint8Array} bytes conteudo do arquivo */
  constructor(bytes) {
    if (!isRavFile(bytes)) {
      throw new Error('Arquivo invalido: nao comeca com a assinatura RAV.');
    }
    this.bytes = bytes;
    this.scan();
  }

  /** Reindexa o arquivo inteiro: strings duplas, propriedades e objetos. */
  scan() {
    const bytes = this.bytes;
    /** @type {Array<{text:string,start:number,end:number}>} */
    const entries = [];
    for (let i = 0; i + 4 < bytes.length; i++) {
      if (bytes[i] !== MARKER[0]) continue;
      const dual = readDual(bytes, i);
      if (!dual) continue;
      entries.push(dual);
      i = dual.end - 1;
    }
    this.entries = entries;

    const objects = [];
    let current = null;
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];

      if (entry.text.startsWith('TRave') && entries[index + 1]) {
        current = {
          className: entry.text,
          name: entries[index + 1].text,
          start: entry.start,
          properties: [],
        };
        objects.push(current);
        index++; // o nome do objeto ja foi consumido
        continue;
      }
      if (!current) continue;

      const property = this.readProperty(index);
      if (property) {
        current.properties.push(property);
        index = property.lastEntry;
      }
    }
    this.objects = objects;
  }

  /** Decodifica a propriedade cujo nome esta em `entries[index]`. */
  readProperty(index) {
    const entries = this.entries;
    const bytes = this.bytes;
    const nameEntry = entries[index];
    const tag = bytes[nameEntry.end];
    const valueStart = nameEntry.end + 1;
    const next = entries[index + 1];

    const property = {
      name: nameEntry.text,
      tag,
      valueStart,
      valueEnd: valueStart,
      lastEntry: index,
      value: null,
      editable: false,
    };

    switch (tag) {
      case TAG.IDENT:
      case TAG.STRING: {
        if (!next || next.start !== valueStart) return null;
        property.value = next.text;
        property.valueEnd = next.end;
        property.lastEntry = index + 1;
        break;
      }
      case TAG.INT8:
      case TAG.INT16:
      case TAG.INT32:
      case TAG.INT64: {
        const size = { 1: 1, 2: 2, 3: 4, 4: 8 }[tag];
        let value = 0;
        for (let i = size - 1; i >= 0; i--) value = value * 256 + bytes[valueStart + i];
        property.value = value;
        property.valueEnd = valueStart + size;
        break;
      }
      case TAG.EXTENDED: {
        property.value = decodeExtended(bytes, valueStart);
        property.valueEnd = valueStart + 10;
        break;
      }
      case TAG.SET: {
        let cursor = index + 1;
        let end = valueStart;
        const items = [];
        while (entries[cursor] && entries[cursor].start === end) {
          end = entries[cursor].end;
          if (!entries[cursor].text) { cursor++; break; }
          items.push(entries[cursor].text);
          cursor++;
        }
        property.value = items;
        property.valueEnd = end;
        property.lastEntry = cursor - 1;
        break;
      }
      default:
        // objeto aninhado (8), binario (9) ou tipo ainda desconhecido:
        // registramos a propriedade, mas sem valor editavel.
        property.value = null;
        property.valueEnd = valueStart;
        break;
    }

    // So liberamos a edicao quando o fim do valor nao invade o proximo
    // registro conhecido — prova de que o tamanho lido esta certo. A
    // comparacao usa a entrada seguinte ao valor, ja que tipos como texto e
    // opcao consomem uma string dupla como valor.
    const following = entries[property.lastEntry + 1];
    const boundaryOk = !following || property.valueEnd <= following.start;
    property.editable = EDITABLE.has(tag) && boundaryOk;
    property.numeric = NUMERIC.has(tag);
    return property;
  }

  /* --------------------------------- edicao -------------------------------- */

  /**
   * Substitui o valor de uma propriedade preservando o resto do arquivo.
   * @returns {boolean} false se o tipo nao for editavel
   */
  setValue(property, value, { rescan = true } = {}) {
    if (!property?.editable) return false;
    let encoded;
    switch (property.tag) {
      case TAG.IDENT:
      case TAG.STRING:
        encoded = encodeDual(value);
        break;
      case TAG.EXTENDED:
        encoded = encodeExtended(Number(value));
        break;
      case TAG.INT8:
      case TAG.INT16:
      case TAG.INT32: {
        const size = { 1: 1, 2: 2, 3: 4 }[property.tag];
        encoded = new Uint8Array(size);
        let remaining = Math.round(Number(value)) >>> 0;
        for (let i = 0; i < size; i++) {
          encoded[i] = remaining & 0xff;
          remaining = Math.floor(remaining / 256);
        }
        break;
      }
      default:
        return false;
    }
    return this.splice(property.valueStart, property.valueEnd, encoded, { rescan });
  }

  /**
   * Altera varias propriedades do mesmo objeto de uma vez (ex.: Left e Top ao
   * arrastar). As gravacoes vao do fim para o comeco do arquivo, assim os
   * deslocamentos ainda nao gravados continuam validos, e o indice e
   * reconstruido uma vez so.
   */
  setMany(object, values) {
    const targets = Object.entries(values)
      .map(([name, value]) => ({ property: this.property(object, name), value }))
      .filter((item) => item.property?.editable)
      .sort((a, b) => b.property.valueStart - a.property.valueStart);
    if (!targets.length) return null;

    const patches = targets.map(({ property, value }) =>
      this.setValue(property, value, { rescan: false })
    );
    this.scan();
    return patches.length === 1 ? patches[0] : { multi: patches };
  }

  /** Reaplica um registro devolvido por `splice`/`setMany` (desfazer/refazer). */
  applyPatch(patch) {
    if (patch?.multi) {
      const inverse = patch.multi
        .slice()
        .sort((a, b) => b.start - a.start)
        .map((item) => this.splice(item.start, item.end, item.bytes, { rescan: false }));
      this.scan();
      return { multi: inverse };
    }
    return this.splice(patch.start, patch.end, patch.bytes);
  }

  /**
   * Troca um trecho de bytes e reindexa o arquivo.
   * @returns registro para desfazer: o trecho original e onde ele estava.
   */
  splice(start, end, replacement, { rescan = true } = {}) {
    const previous = this.bytes.slice(start, end);
    const out = new Uint8Array(this.bytes.length - (end - start) + replacement.length);
    out.set(this.bytes.subarray(0, start), 0);
    out.set(replacement, start);
    out.set(this.bytes.subarray(end), start + replacement.length);
    this.bytes = out;
    if (rescan) this.scan();
    return { start, end: start + replacement.length, bytes: previous };
  }

  serialize() {
    return this.bytes;
  }

  /* -------------------------------- consultas ------------------------------ */

  /**
   * O arquivo comeca com um dicionario de classes e metodos (nomes como
   * `TRaveComponent.GetName`). Ele nao faz parte do relatorio.
   */
  isDictionaryEntry(object) {
    return (
      !object.name
      || object.name === 'Value'
      || object.name.includes('.')
      || object.name.startsWith('TRave')
    );
  }

  get reportObjects() {
    return this.objects.filter((object) => !this.isDictionaryEntry(object));
  }

  /** Objetos agrupados por relatorio e pagina, na ordem do arquivo. */
  outline() {
    const groups = [];
    let report = null;
    let page = null;
    for (const object of this.reportObjects) {
      if (object.className === 'TRaveReport') {
        report = { name: object.name, object, pages: [] };
        groups.push(report);
        page = null;
        continue;
      }
      if (object.className === 'TRavePage') {
        page = { name: object.name, object, items: [] };
        if (!report) {
          report = { name: '(sem relatorio)', object: null, pages: [] };
          groups.push(report);
        }
        report.pages.push(page);
        continue;
      }
      if (page) page.items.push(object);
    }
    return groups;
  }

  /**
   * Arvore de desenho de uma pagina: cada container com os objetos que o
   * seguem no arquivo. Objetos sem geometria ficam de fora.
   */
  pageTree(page) {
    const roots = [];
    let container = null;
    for (const object of page.items) {
      if (!this.rect(object)) continue;
      const node = { object, children: [] };
      if (CONTAINER_CLASSES.has(object.className)) {
        container = node;
        roots.push(node);
      } else if (container) {
        container.children.push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  }

  /** Container ao qual o objeto pertence, se houver. */
  containerOf(page, object) {
    let container = null;
    for (const item of page.items) {
      if (item === object) return container;
      if (CONTAINER_CLASSES.has(item.className) && this.rect(item)) container = item;
    }
    return null;
  }

  property(object, name) {
    return object.properties.find((property) => property.name === name) || null;
  }

  /**
   * Fonte de um objeto de texto. O Rave grava a fonte como objeto aninhado
   * (`Font` com o tipo 8) e as propriedades seguintes — Name, Size, Style,
   * Color — pertencem a ela.
   */
  fontOf(object) {
    const start = object.properties.findIndex(
      (property) => property.name === 'Font' && property.tag === TAG.OBJECT
    );
    const font = { name: 'Arial', size: 10, bold: false, italic: false, underline: false, color: 0 };
    if (start === -1) return font;

    for (const property of object.properties.slice(start + 1, start + 8)) {
      switch (property.name) {
        case 'Name': if (property.tag === TAG.STRING) font.name = property.value; break;
        case 'Size': font.size = Number(property.value) || font.size; break;
        case 'Color': font.color = Number(property.value) || 0; break;
        case 'Style':
          if (Array.isArray(property.value)) {
            font.bold = property.value.includes('fsBold');
            font.italic = property.value.includes('fsItalic');
            font.underline = property.value.includes('fsUnderline');
          }
          break;
        case 'Charset': break;
        default: return font; // saiu do bloco da fonte
      }
    }
    return font;
  }

  /** Tamanho da pagina em polegadas. */
  pageSize(page) {
    return {
      width: this.property(page, 'PageWidth')?.value ?? 8.5,
      height: this.property(page, 'PageHeight')?.value ?? 11,
    };
  }

  /** Retangulo em polegadas, como o Rave grava. */
  rect(object) {
    const value = (name) => {
      const property = this.property(object, name);
      return property && property.tag === TAG.EXTENDED ? property.value : null;
    };
    const left = value('Left');
    const top = value('Top');
    if (left === null || top === null) return null;
    return { left, top, width: value('Width') ?? 0, height: value('Height') ?? 0 };
  }

  /**
   * Cor TColor (0x00BBGGRR) -> `#rrggbb`. Vale a mesma convencao do Delphi:
   * 0x1FFFFFFF e "sem cor" e valores acima de 0x00FFFFFF sao cores de sistema
   * — nos dois casos devolvemos o padrao informado.
   */
  colorOf(object, name, fallback = null) {
    const property = this.property(object, name);
    if (!property || property.value === null || Array.isArray(property.value)) return fallback;
    const value = Number(property.value);
    if (!Number.isFinite(value) || value < 0 || value > 0xffffff) return fallback;
    const b = (value >> 16) & 0xff;
    const g = (value >> 8) & 0xff;
    const r = value & 0xff;
    return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
  }

  /** Retangulo do objeto em milimetros, quando ele tiver geometria. */
  rectMm(object) {
    const value = (name) => {
      const property = this.property(object, name);
      return property && property.tag === TAG.EXTENDED ? property.value * INCH_TO_MM : null;
    };
    const left = value('Left');
    const top = value('Top');
    if (left === null || top === null) return null;
    return { left, top, width: value('Width') ?? 0, height: value('Height') ?? 0 };
  }

  /** Texto que o objeto mostra: literal, campo de dados ou expressao. */
  displayText(object) {
    for (const name of ['Text', 'DataField', 'FullName', 'Name']) {
      const property = this.property(object, name);
      if (property && property.tag === TAG.STRING && property.value) return property.value;
    }
    return '';
  }

  get stats() {
    const byClass = new Map();
    for (const object of this.objects) {
      byClass.set(object.className, (byClass.get(object.className) || 0) + 1);
    }
    return {
      size: this.bytes.length,
      objects: this.objects.length,
      identifiers: this.entries.length,
      byClass: [...byClass.entries()].sort((a, b) => b[1] - a[1]),
    };
  }
}
