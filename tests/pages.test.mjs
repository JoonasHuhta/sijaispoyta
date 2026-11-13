import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test('Testiversio rakentuu ja käyttää palvelimen sääntöjä', () => {
  const dir = new URL('../_site_test/', import.meta.url);
  execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/build-pages.mjs', import.meta.url)), '_site_test']);
  try {
    assert.ok(existsSync(new URL('img/logo.png', dir)));
    assert.match(readFileSync(new URL('index.html', dir), 'utf8'), /data-mode="demo"/);
    assert.match(readFileSync(new URL('server/board.js', dir), 'utf8'), /from '\.\.\/domain\.js'/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
