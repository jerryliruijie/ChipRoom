import { readdirSync } from 'node:fs';
import { extname, join } from 'node:path';

const types = new Map(Object.entries({
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.txt': 'text/plain', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
}));

// Pages publishes the contents of public/ at the configured project subpath.
// Build the matching URL map for the LAN server and the hosted Worker.
export function publicFiles(root, prefix = '') {
  const assets = new Map();
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const path = prefix + entry.name;
    if (entry.isDirectory()) {
      for (const [url, file] of publicFiles(root, path + '/')) assets.set(url, file);
    } else if (entry.isFile()) {
      const mime = types.get(extname(path).toLowerCase());
      if (mime) assets.set('/' + path, { path, mime });
    }
  }
  return assets;
}
