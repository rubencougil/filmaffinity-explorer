const { createHash } = require('node:crypto');

function buildLibraryAssets(payload) {
  if (!Array.isArray(payload?.libraries)) {
    throw new Error('Library data must contain a libraries array.');
  }

  const assets = new Map();
  function addAsset(directory, value) {
    const json = JSON.stringify(value);
    const hash = createHash('sha256').update(json).digest('hex');
    const pathname = `data/${directory}/${hash}.json`;
    assets.set(pathname, json);
    return pathname;
  }

  const comparisons = [];
  const libraries = payload.libraries.map((library) => {
    if (!library || typeof library.userName !== 'string' || !Array.isArray(library.ratings)) {
      throw new Error('Each library must contain a userName and a ratings array.');
    }
    comparisons.push([
      library.userName.trim(),
      library.ratings.map((record) => [
        String(record.url || record.title || '').trim(),
        record.rating ?? null,
        String(record.ratedAt || '').trim()
      ])
    ]);
    return { userName: library.userName, path: addAsset('libraries', library) };
  });

  assets.set('data/catalog.json', JSON.stringify({
    format: 'filmaffinity-split-v1',
    generatedAt: String(payload.generatedAt || ''),
    libraries,
    comparisonsPath: addAsset('comparisons', comparisons)
  }));
  // Keep the old URL usable by already-open pages from the previous deployment.
  assets.set('data/libraries.json', JSON.stringify(payload));
  return assets;
}

module.exports = { buildLibraryAssets };
