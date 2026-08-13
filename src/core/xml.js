/**
 * Parser/serializador XML minimalista, focado em fidelidade byte-a-byte.
 *
 * Arquivos .fr3 sao gerados pelo FastReport (Delphi) e nao seguem a formatacao
 * de nenhuma biblioteca XML comum: ordem de atributos, entidades numericas
 * (&#13;&#10;) e indentacao precisam sobreviver a um ciclo abrir -> salvar,
 * senao o diff do arquivo fica ilegivel e o report pode deixar de abrir no
 * designer original. Por isso guardamos o texto cru de tudo que nao foi
 * editado e so re-serializamos o que mudou.
 */

/** @typedef {{type:'raw', text:string, parent?:Element}} RawNode */
/** @typedef {{pre:string, name:string, quote:string, raw:string|null}} Attr */
/**
 * @typedef {Object} Element
 * @property {'element'} type
 * @property {string} name
 * @property {Attr[]} attrs
 * @property {string} tail       espacos antes de `>` ou `/>`
 * @property {boolean} selfClosing
 * @property {Array<Element|RawNode>} children
 * @property {Element|null} parent
 */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Converte entidades XML (incluindo as numericas usadas pelo FastReport). */
export function decodeEntities(value) {
  if (value == null || value.indexOf('&') === -1) return value ?? '';
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (all, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : all;
    }
    return body in ENTITIES ? ENTITIES[body] : all;
  });
}

/** Escapa um valor de atributo no mesmo estilo do FastReport. */
export function encodeAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&#34;')
    .replace(/\r/g, '&#13;')
    .replace(/\n/g, '&#10;');
}

function isNameChar(ch) {
  return ch !== undefined && !/[\s=/>]/.test(ch);
}

function parseTag(text, start) {
  let i = start + 1;
  let name = '';
  while (isNameChar(text[i])) name += text[i++];

  /** @type {Element} */
  const node = {
    type: 'element',
    name,
    attrs: [],
    tail: '',
    selfClosing: false,
    children: [],
    parent: null,
  };

  for (;;) {
    let pre = '';
    while (i < text.length && /\s/.test(text[i])) pre += text[i++];

    if (i >= text.length) {
      node.tail = pre;
      return { node, end: i };
    }
    if (text[i] === '>') {
      node.tail = pre;
      return { node, end: i + 1 };
    }
    if (text[i] === '/' && text[i + 1] === '>') {
      node.tail = pre;
      node.selfClosing = true;
      return { node, end: i + 2 };
    }

    let attrName = '';
    while (isNameChar(text[i])) attrName += text[i++];
    if (!attrName) {
      // Caractere inesperado: consome para nao entrar em loop infinito.
      i++;
      continue;
    }

    /** @type {Attr} */
    const attr = { pre, name: attrName, quote: '"', raw: null };
    if (text[i] === '=') {
      i++;
      const quote = text[i];
      if (quote === '"' || quote === "'") {
        i++;
        const end = text.indexOf(quote, i);
        const stop = end === -1 ? text.length : end;
        attr.quote = quote;
        attr.raw = text.slice(i, stop);
        i = stop + 1;
      } else {
        let unquoted = '';
        while (i < text.length && !/[\s/>]/.test(text[i])) unquoted += text[i++];
        attr.quote = '';
        attr.raw = unquoted;
      }
    }
    node.attrs.push(attr);
  }
}

/**
 * Le um documento XML inteiro.
 * @returns {Element} no sintetico `#document` com os nos de topo como filhos.
 */
export function parseDocument(text) {
  /** @type {Element} */
  const doc = {
    type: 'element',
    name: '#document',
    attrs: [],
    tail: '',
    selfClosing: false,
    children: [],
    parent: null,
  };
  const stack = [doc];
  const push = (node) => {
    const parent = stack[stack.length - 1];
    node.parent = parent;
    parent.children.push(node);
  };

  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt === -1) {
      push({ type: 'raw', text: text.slice(i) });
      break;
    }
    if (lt > i) push({ type: 'raw', text: text.slice(i, lt) });

    const literal = (open, close) => {
      const end = text.indexOf(close, lt + open.length);
      const stop = end === -1 ? text.length : end + close.length;
      push({ type: 'raw', text: text.slice(lt, stop) });
      return stop;
    };

    if (text.startsWith('<!--', lt)) { i = literal('<!--', '-->'); continue; }
    if (text.startsWith('<![CDATA[', lt)) { i = literal('<![CDATA[', ']]>'); continue; }
    if (text.startsWith('<?', lt)) { i = literal('<?', '?>'); continue; }
    if (text.startsWith('<!', lt)) { i = literal('<!', '>'); continue; }

    if (text[lt + 1] === '/') {
      const end = text.indexOf('>', lt);
      const stop = end === -1 ? text.length : end + 1;
      const name = text.slice(lt + 2, stop - 1).trim();
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === name) { stack.length = k; break; }
      }
      i = stop;
      continue;
    }

    const { node, end } = parseTag(text, lt);
    push(node);
    if (!node.selfClosing) stack.push(node);
    i = end;
  }

  return doc;
}

/** Reconstroi o texto XML de um no (ou do documento inteiro). */
export function serialize(node) {
  if (node.type === 'raw') return node.text;

  const inner = node.children.map(serialize).join('');
  if (node.name === '#document') return inner;

  let out = '<' + node.name;
  for (const attr of node.attrs) {
    out += attr.pre + attr.name;
    if (attr.raw !== null) {
      out += '=' + attr.quote + attr.raw + attr.quote;
    }
  }
  out += node.tail;
  if (node.selfClosing) return out + '/>';
  return out + '>' + inner + '</' + node.name + '>';
}

/* -------------------------------------------------------------------------- */
/* Helpers de arvore                                                          */
/* -------------------------------------------------------------------------- */

export function isElement(node) {
  return !!node && node.type === 'element';
}

/** Filhos elemento; com `names`, apenas as tags informadas. */
export function childElements(node, names) {
  if (!isElement(node)) return [];
  const set = names ? new Set(Array.isArray(names) ? names : [names]) : null;
  return node.children.filter((c) => isElement(c) && (!set || set.has(c.name)));
}

export function firstChild(node, name) {
  return childElements(node, name)[0] || null;
}

/** Percorre todos os elementos da subarvore (inclusive `node`). */
export function* walk(node) {
  if (!isElement(node)) return;
  if (node.name !== '#document') yield node;
  for (const child of node.children) {
    if (isElement(child)) yield* walk(child);
  }
}

export function findAttr(node, name) {
  if (!isElement(node)) return null;
  const lower = name.toLowerCase();
  return node.attrs.find((a) => a.name.toLowerCase() === lower) || null;
}

export function hasAttr(node, name) {
  return findAttr(node, name) !== null;
}

/** Valor decodificado de um atributo, ou `fallback` se ausente. */
export function getAttr(node, name, fallback = null) {
  const attr = findAttr(node, name);
  if (!attr || attr.raw === null) return fallback;
  return decodeEntities(attr.raw);
}

/** Define/atualiza um atributo. `value === null` remove o atributo. */
export function setAttr(node, name, value) {
  const attr = findAttr(node, name);
  if (value === null || value === undefined) {
    if (attr) node.attrs.splice(node.attrs.indexOf(attr), 1);
    return;
  }
  const raw = encodeAttr(value);
  if (attr) {
    if (attr.raw === raw) return;
    attr.raw = raw;
    attr.quote = attr.quote || '"';
    return;
  }
  node.attrs.push({ pre: ' ', name, quote: '"', raw });
}

/** Cria um elemento vazio (auto-fechado) com os atributos informados. */
export function createElement(name, attrs = {}) {
  /** @type {Element} */
  const node = {
    type: 'element',
    name,
    attrs: [],
    tail: '',
    selfClosing: true,
    children: [],
    parent: null,
  };
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue;
    setAttr(node, key, value);
  }
  return node;
}

/** Copia profunda de um no (sem vinculo com o pai original). */
export function cloneNode(node) {
  if (node.type === 'raw') return { type: 'raw', text: node.text };
  /** @type {Element} */
  const copy = {
    type: 'element',
    name: node.name,
    attrs: node.attrs.map((a) => ({ ...a })),
    tail: node.tail,
    selfClosing: node.selfClosing,
    children: [],
    parent: null,
  };
  for (const child of node.children) {
    const childCopy = cloneNode(child);
    childCopy.parent = copy;
    copy.children.push(childCopy);
  }
  return copy;
}

/** Indentacao (quebra + espacos) usada pelos filhos de `parent`. */
function childIndent(parent) {
  for (const child of parent.children) {
    if (child.type === 'raw' && /\r?\n[ \t]*$/.test(child.text)) {
      return child.text.match(/\r?\n[ \t]*$/)[0];
    }
  }
  let depth = 0;
  for (let n = parent; n && n.name !== '#document'; n = n.parent) depth++;
  return '\r\n' + '  '.repeat(depth);
}

/** Acrescenta um elemento como ultimo filho, respeitando a indentacao. */
export function appendChild(parent, child) {
  const indent = childIndent(parent);
  const last = parent.children[parent.children.length - 1];
  if (last && last.type === 'raw' && /^\s*$/.test(last.text)) {
    // Reaproveita o espaco final como indentacao do novo filho e recria o
    // recuo da tag de fechamento depois dele.
    parent.children.pop();
    parent.children.push({ type: 'raw', text: indent, parent });
    child.parent = parent;
    parent.children.push(child);
    parent.children.push({ type: 'raw', text: last.text, parent });
  } else {
    parent.children.push({ type: 'raw', text: indent, parent });
    child.parent = parent;
    parent.children.push(child);
    const closeIndent = indent.replace(/[ \t]{2}$/, '');
    parent.children.push({ type: 'raw', text: closeIndent, parent });
  }
  if (parent.selfClosing) parent.selfClosing = false;
  return child;
}

/** Remove um elemento e o espaco em branco que o precedia. */
export function removeChild(child) {
  const parent = child.parent;
  if (!parent) return false;
  const index = parent.children.indexOf(child);
  if (index === -1) return false;
  parent.children.splice(index, 1);
  const before = parent.children[index - 1];
  if (before && before.type === 'raw' && /^\s*$/.test(before.text) && before.text.includes('\n')) {
    parent.children.splice(index - 1, 1);
  }
  child.parent = null;
  return true;
}
