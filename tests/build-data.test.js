const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { buildLibraryAssets } = require('../scripts/build-data');

const payload = {
  generatedAt: '2026-10-21T09:00:00Z',
  libraries: [
    {
      userName: 'Active', status: 'completed', lastSyncedAt: '2026-10-20',
      ratings: [{ title: 'Film', url: ' https://example.test/film ', rating: 8, posterUrl: 'poster.jpg' }]
    },
    {
      userName: '../Peer & other', status: 'failed', error: 'A sync error',
      ratings: [
        { title: ' Film ', rating: '9', ratedAt: ' 2026-10-20 ' },
        { title: 'No rating', rating: null }
      ]
    }
  ]
};

function catalog(assets) {
  return JSON.parse(assets.get('data/catalog.json'));
}

test('build data preserves source and legacy data while producing independent user payloads', () => {
  const before = structuredClone(payload);
  const assets = buildLibraryAssets(payload);
  const index = catalog(assets);
  assert.equal(index.format, 'filmaffinity-split-v1');
  assert.equal(index.generatedAt, payload.generatedAt);
  assert.deepEqual(index.libraries.map((entry) => entry.userName), payload.libraries.map((entry) => entry.userName));
  for (const [position, entry] of index.libraries.entries()) {
    assert.match(entry.path, /^data\/libraries\/[a-f0-9]{64}\.json$/);
    assert.deepEqual(JSON.parse(assets.get(entry.path)), payload.libraries[position]);
    assert.equal(Object.hasOwn(entry, 'ratings'), false);
  }
  assert.deepEqual(JSON.parse(assets.get('data/libraries.json')), payload);
  assert.deepEqual(payload, before);
  assert.deepEqual(buildLibraryAssets(payload), assets);
});

test('comparison data contains only matching keys, original ratings and vote dates', () => {
  const assets = buildLibraryAssets(payload);
  assert.deepEqual(JSON.parse(assets.get(catalog(assets).comparisonsPath)), [
    ['Active', [['https://example.test/film', 8, '']]],
    ['../Peer & other', [['Film', '9', '2026-10-20'], ['No rating', null, '']]]
  ]);
});

test('content-addressed assets change only when their contents change', () => {
  const initial = catalog(buildLibraryAssets(payload));
  const changed = structuredClone(payload);
  changed.libraries[0].ratings[0].posterUrl = 'updated-poster.jpg';
  const next = catalog(buildLibraryAssets(changed));
  assert.notEqual(next.libraries[0].path, initial.libraries[0].path);
  assert.equal(next.libraries[1].path, initial.libraries[1].path);
  assert.equal(next.comparisonsPath, initial.comparisonsPath);
  changed.libraries[0].ratings[0].rating = 7;
  assert.notEqual(catalog(buildLibraryAssets(changed)).comparisonsPath, initial.comparisonsPath);
});

test('empty data is supported and malformed library containers fail explicitly', () => {
  const assets = buildLibraryAssets({ libraries: [] });
  assert.deepEqual(catalog(assets).libraries, []);
  assert.deepEqual(JSON.parse(assets.get(catalog(assets).comparisonsPath)), []);
  for (const value of [null, {}, { libraries: {} }]) {
    assert.throws(() => buildLibraryAssets(value), /libraries array/);
  }
  for (const library of [null, {}, { userName: 'Active', ratings: {} }]) {
    assert.throws(() => buildLibraryAssets({ libraries: [library] }), /userName and a ratings array/);
  }
});

test('production output contains matching shards and points data-driven pages at the small catalog', () => {
  const root = path.join(__dirname, '..');
  const source = JSON.parse(fs.readFileSync(path.join(root, 'public', 'data', 'libraries.json'), 'utf8'));
  for (const [pathname, contents] of buildLibraryAssets(source)) {
    assert.equal(fs.readFileSync(path.join(root, 'dist', pathname), 'utf8'), contents);
  }
  for (const file of ['index.html', 'watch-next.html', 'affinity.html', 'stats.html']) {
    const html = fs.readFileSync(path.join(root, 'dist', file), 'utf8');
    assert.match(html, /href="data\/catalog\.json"[^>]*data-library-index/);
    assert.doesNotMatch(html, /href="data\/libraries\.json"/);
  }
});
