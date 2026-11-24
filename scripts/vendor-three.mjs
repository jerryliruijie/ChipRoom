import { copyFile, mkdir } from 'node:fs/promises';

const from = new URL('../node_modules/three/', import.meta.url);
const to = new URL('../public/vendor/', import.meta.url);
await mkdir(to, { recursive: true });
for (const [source, destination] of [
  ['build/three.module.min.js', 'three.js'],
  ['build/three.core.min.js', 'three.core.min.js'],
  ['LICENSE', 'three-LICENSE.txt'],
]) {
  await copyFile(new URL(source, from), new URL(destination, to));
}
