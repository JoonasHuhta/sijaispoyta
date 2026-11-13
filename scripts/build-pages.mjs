// Rakentaa staattisen testiversion (GitHub Pages) kansioon _site/.
// Sama käyttöliittymä ja samat säännöt kuin palvelimella; tiedot selaimen localStorageen.
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const out = new URL('../' + (process.argv[2] || '_site') + '/', import.meta.url);
rmSync(out, { recursive: true, force: true });
mkdirSync(new URL('server/', out), { recursive: true });
cpSync(new URL('../public/', import.meta.url), out, { recursive: true });
for (const file of readdirSync(new URL('../server/', import.meta.url)).filter(f => f.endsWith('.js'))) {
  const code = readFileSync(new URL('../server/' + file, import.meta.url), 'utf8').replaceAll("'../public/domain.js'", "'../domain.js'");
  writeFileSync(new URL('server/' + file, out), code);
}
const html = readFileSync(new URL('index.html', out), 'utf8').replace('<html lang="fi">', '<html lang="fi" data-mode="demo">');
writeFileSync(new URL('index.html', out), html);
writeFileSync(new URL('.nojekyll', out), '');
console.log('Testiversio rakennettu kansioon', process.argv[2] || '_site');
