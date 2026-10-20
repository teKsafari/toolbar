// Last build step (D-211): the hand-written types next to the ES modules, then the npm tarball,
// dist/open-toolbar-embed.tgz, which the server serves at /embed/open-toolbar-embed.tgz
// (`npm i https://toolbar.example.com/embed/open-toolbar-embed.tgz`). Prints the size of embed.js.
import { execFileSync } from 'node:child_process';
import { copyFileSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const root = new URL('..', import.meta.url).pathname;
const dist = root + 'dist/';
for (const f of ['index.d.ts', 'react.d.ts']) copyFileSync(root + 'types/' + f, dist + f);

for (const f of readdirSync(dist)) if (f.endsWith('.tgz')) rmSync(dist + f);
const out = execFileSync('npm', ['pack', '--pack-destination', dist, '--json'], { cwd: root, encoding: 'utf8' });
const [{ filename }] = JSON.parse(out);
renameSync(dist + filename, dist + 'open-toolbar-embed.tgz');

const js = readFileSync(dist + 'embed.js');
console.log(`embed.js ${(js.length / 1024).toFixed(1)} kB, ${(gzipSync(js).length / 1024).toFixed(1)} kB gzipped; dist/open-toolbar-embed.tgz`);
