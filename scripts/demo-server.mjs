// Paikallinen testiversio ilman kirjautumista ja tietokantaa: npm run demo
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, normalize } from 'node:path';

const port = Number(process.env.PORT || 4318);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const root = new URL('../', import.meta.url);

createServer(async (req, res) => {
  try {
    let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
    if (path.includes('..')) throw new Error('bad path');
    let body;
    if (/^server\/[\w-]+\.js$/.test(path)) body = (await readFile(new URL(path, root), 'utf8')).replaceAll("'../public/domain.js'", "'../domain.js'");
    else {
      if (!path || path.endsWith('/')) path += 'index.html';
      body = await readFile(new URL('public/' + path, root));
      if (path === 'index.html') body = body.toString().replace('<html lang="fi">', '<html lang="fi" data-mode="demo">');
    }
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Ei löydy');
  }
}).listen(port, '127.0.0.1', () => console.log(`Sijaispöydän testiversio: http://127.0.0.1:${port}`));
