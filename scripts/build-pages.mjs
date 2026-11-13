// Rakentaa staattisen testiversion (GitHub Pages) kansioon _site/.
// Sama käyttöliittymä ja samat säännöt kuin palvelimella; tiedot selaimen localStorageen.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const out = new URL('../' + (process.argv[2] || '_site') + '/', import.meta.url);
rmSync(out, { recursive: true, force: true });
mkdirSync(new URL('server/', out), { recursive: true });
cpSync(new URL('../public/', import.meta.url), out, { recursive: true });
const board = readFileSync(new URL('../server/board.js', import.meta.url), 'utf8').replace("'../public/domain.js'", "'../domain.js'");
writeFileSync(new URL('server/board.js', out), board);
const html = readFileSync(new URL('index.html', out), 'utf8').replace('<html lang="fi">', '<html lang="fi" data-mode="demo">');
writeFileSync(new URL('index.html', out), html);
writeFileSync(new URL('.nojekyll', out), '');
console.log('Testiversio rakennettu kansioon', process.argv[2] || '_site');
