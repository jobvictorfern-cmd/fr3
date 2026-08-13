#!/usr/bin/env node
/**
 * Monta a pasta `dist/` com os arquivos que o aplicativo precisa: `npm run build`.
 *
 * Nao ha bundler nem transpilacao — o projeto e ES modules puro. Isso existe
 * so para o Tauri (e para publicar em um servidor) receber apenas o necessario,
 * sem `node_modules`, `src-tauri` e afins.
 */

import { cpSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const ENTRIES = ['index.html', 'styles', 'src', 'samples'];

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

for (const entry of ENTRIES) {
  cpSync(join(ROOT, entry), join(DIST, entry), { recursive: true });
  const target = statSync(join(DIST, entry));
  console.log(`${entry.padEnd(12)} ${target.isDirectory() ? 'pasta' : `${target.size} bytes`}`);
}

console.log(`\ndist/ pronto em ${DIST}`);
