import { readFileSync, readdirSync } from 'node:fs';
import { extname } from 'node:path';

const web = new URL('../web/', import.meta.url);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function asset(url, type) {
  return { type, content: readFileSync(url, 'utf8') };
}

export const ASSETS = Object.create(null);
for (const entry of readdirSync(web, { withFileTypes: true })) {
  const type = types[extname(entry.name)];
  if (entry.isFile() && type) {
    ASSETS['/' + entry.name] = asset(new URL(entry.name, web), type);
  }
}

ASSETS['/coletor-local.html'] = ASSETS['/collector-redirect.html'];
ASSETS['/metodologia.md'] = asset(
  new URL('../docs/metodologia.md', import.meta.url),
  'text/markdown; charset=utf-8',
);
