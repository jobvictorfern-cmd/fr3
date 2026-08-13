#!/usr/bin/env node
/**
 * Gera os icones do aplicativo (PNG + ICO) sem depender de bibliotecas
 * externas: `npm run icons`.
 *
 * O desenho e vetorial e rasterizado com 4x4 subamostras por pixel, entao
 * qualquer tamanho sai com as bordas suaves. Para trocar o icone, altere as
 * figuras em `draw()` — ou substitua os arquivos por um icone proprio com
 * `npx @tauri-apps/cli icon logo.png`.
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src-tauri', 'icons');
const SAMPLES = 4; // subamostras por eixo

const COLORS = {
  fundo: [0x1f, 0x24, 0x30, 255],
  folha: [0xff, 0xff, 0xff, 255],
  destaque: [0x2f, 0x6f, 0xeb, 255],
  texto: [0x8a, 0x94, 0xa6, 255],
};

/* ------------------------------- primitivas ------------------------------- */

const roundedRect = (x, y, w, h, r) => (px, py) => {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r;
};

/** Figuras em coordenadas normalizadas (0..1), desenhadas de tras para frente. */
function shapes() {
  const bars = [
    [0.32, 0.255, 0.36, 0.055, COLORS.destaque],
    [0.32, 0.4, 0.36, 0.035, COLORS.texto],
    [0.32, 0.475, 0.28, 0.035, COLORS.texto],
    [0.32, 0.55, 0.32, 0.035, COLORS.texto],
    [0.44, 0.66, 0.24, 0.06, COLORS.destaque],
  ];
  return [
    { hit: roundedRect(0.03, 0.03, 0.94, 0.94, 0.2), color: COLORS.fundo },
    { hit: roundedRect(0.22, 0.14, 0.56, 0.72, 0.035), color: COLORS.folha },
    ...bars.map(([x, y, w, h, color]) => ({ hit: roundedRect(x, y, w, h, h / 2), color })),
  ];
}

/** Rasteriza as figuras em um buffer RGBA de `size` x `size`. */
function draw(size) {
  const figures = shapes();
  const pixels = Buffer.alloc(size * size * 4);
  const step = 1 / (size * SAMPLES);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const px = (x * SAMPLES + sx + 0.5) * step;
          const py = (y * SAMPLES + sy + 0.5) * step;
          let color = null;
          for (const figure of figures) if (figure.hit(px, py)) color = figure.color;
          if (color) {
            r += color[0];
            g += color[1];
            b += color[2];
            a += color[3];
          }
        }
      }
      const total = SAMPLES * SAMPLES;
      const alpha = a / total;
      const offset = (y * size + x) * 4;
      // Cor media apenas das subamostras cobertas, para nao escurecer a borda.
      const covered = alpha === 0 ? 1 : a / 255;
      pixels[offset] = Math.round(r / covered);
      pixels[offset + 1] = Math.round(g / covered);
      pixels[offset + 2] = Math.round(b / covered);
      pixels[offset + 3] = Math.round(alpha);
    }
  }
  return pixels;
}

/* --------------------------------- PNG ----------------------------------- */

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, crc]);
}

function encodePng(size, pixels) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filtro "none"
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // profundidade
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* --------------------------------- ICO ----------------------------------- */

function encodeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // tipo icone
  header.writeUInt16LE(entries.length, 4);

  const directory = Buffer.alloc(16 * entries.length);
  let offset = header.length + directory.length;
  entries.forEach(({ size, png }, index) => {
    const at = index * 16;
    directory[at] = size >= 256 ? 0 : size;
    directory[at + 1] = size >= 256 ? 0 : size;
    directory.writeUInt16LE(1, at + 4); // planos
    directory.writeUInt16LE(32, at + 6); // bits por pixel
    directory.writeUInt32LE(png.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });

  return Buffer.concat([header, directory, ...entries.map((entry) => entry.png)]);
}

/* -------------------------------- geracao -------------------------------- */

mkdirSync(ICONS_DIR, { recursive: true });

const cache = new Map();
const png = (size) => {
  if (!cache.has(size)) cache.set(size, encodePng(size, draw(size)));
  return cache.get(size);
};

const files = {
  '32x32.png': png(32),
  '128x128.png': png(128),
  '128x128@2x.png': png(256),
  'icon.png': png(512),
  'icon.ico': encodeIco([16, 32, 48, 64, 128, 256].map((size) => ({ size, png: png(size) }))),
};

for (const [name, data] of Object.entries(files)) {
  writeFileSync(join(ICONS_DIR, name), data);
  console.log(`${name.padEnd(16)} ${String(data.length).padStart(7)} bytes`);
}
