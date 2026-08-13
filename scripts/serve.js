#!/usr/bin/env node
/**
 * Servidor estatico minimo (sem dependencias) para abrir o editor durante o
 * desenvolvimento: `npm start`.
 *
 * Um servidor e necessario porque o editor usa modulos ES e `fetch` para
 * carregar o relatorio de exemplo — abrir o index.html via file:// nao funciona.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const PORT = Number(process.env.PORT || 5173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.fr3': 'application/xml; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const relative = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    let file = join(ROOT, relative === '/' ? 'index.html' : relative);
    if (!file.startsWith(ROOT)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    const info = await stat(file).catch(() => null);
    if (info?.isDirectory()) file = join(file, 'index.html');

    const body = await readFile(file);
    response.writeHead(200, {
      'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    response.end(body);
  } catch (error) {
    const notFound = error.code === 'ENOENT';
    response.writeHead(notFound ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(notFound ? 'Nao encontrado' : String(error));
  }
});

server.listen(PORT, () => {
  console.log(`Editor FR3 em http://localhost:${PORT}`);
});
