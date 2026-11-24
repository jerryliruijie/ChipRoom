import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { publicFiles } from './scripts/public-files.mjs';
const entries = [];
for (const [url, {path, mime}] of publicFiles('public')) {
  const data = await readFile('public/' + path);
  const source = mime.startsWith('text/') || mime === 'image/svg+xml'
    ? JSON.stringify(data.toString('utf8'))
    : `Uint8Array.from(atob(${JSON.stringify(data.toString('base64'))}), c => c.charCodeAt(0))`;
  entries.push(`${JSON.stringify(url)}:[${JSON.stringify(mime)},${source}]`);
}
const engine = await readFile('public/holdem.js','utf8');
const handler = (await readFile('worker.mjs','utf8')).replace("import { createRoom, apply, view } from './engine.mjs';", '');
await mkdir('dist/server',{recursive:true});
await mkdir('dist/.openai',{recursive:true});
await copyFile('.openai/hosting.json','dist/.openai/hosting.json');
await writeFile('dist/server/index.js', 'const assets = {'+entries.join(',\n')+'};\n'+engine+'\n'+handler);

