const fs = require('node:fs');
const path = require('node:path');
const { transformSync } = require('esbuild');
const { buildLibraryAssets } = require('./build-data');

const source = path.join(__dirname, '..', 'public');
const destination = path.join(__dirname, '..', 'dist');
fs.rmSync(destination, { recursive: true, force: true });
fs.mkdirSync(destination, { recursive: true });
fs.cpSync(source, destination, { recursive: true });

for (const entry of fs.readdirSync(destination)) {
  const extension = path.extname(entry);
  if (extension === '.html') {
    const file = path.join(destination, entry);
    const html = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, html.replace('href="data/libraries.json"', 'href="data/catalog.json"'));
  }
  if (!['.js', '.css'].includes(extension)) continue;
  const file = path.join(destination, entry);
  const result = transformSync(fs.readFileSync(file, 'utf8'), {
    loader: extension.slice(1),
    minify: true,
    target: 'es2022'
  });
  fs.writeFileSync(file, result.code);
}

const libraries = path.join(destination, 'data', 'libraries.json');
const assets = buildLibraryAssets(JSON.parse(fs.readFileSync(libraries, 'utf8')));
for (const [pathname, json] of assets) {
  const file = path.join(destination, pathname);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, json);
}
console.log('Production site built in dist/');
