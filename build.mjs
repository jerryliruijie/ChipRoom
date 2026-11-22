import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
const pages = {};
for (const [file, mime] of [['index.html','text/html'],['app.js','text/javascript'],['style.css','text/css']]) {
  pages['/' + file] = [mime, await readFile('public/' + file, 'utf8')];
}
const engine = await readFile('engine.mjs','utf8');
const handler = (await readFile('worker.mjs','utf8')).replace("import { createRoom, apply, view } from './engine.mjs';", '');
await mkdir('dist/server',{recursive:true});
await mkdir('dist/.openai',{recursive:true});
await copyFile('.openai/hosting.json','dist/.openai/hosting.json');
await writeFile('dist/server/index.js', 'const assets = '+JSON.stringify(pages)+';\n'+engine+'\n'+handler);

