const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { readConfig, normalizeUsers } = require('../scripts/sync-static-data');

test('missing configuration explains how to set up real users', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-static-config-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  assert.throws(() => readConfig(path.join(directory, 'config.json')), (error) => {
    assert.match(error.message, /Missing config\.json/);
    assert.match(error.message, /cp config\.example\.json config\.json/);
    assert.match(error.message, /FilmAffinity user IDs/);
    return true;
  });
});

test('invalid JSON is reported separately from an empty user list', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-static-config-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, 'config.json');
  fs.writeFileSync(configPath, '{"filmaffinity":');

  assert.throws(() => readConfig(configPath), /Invalid JSON in config\.json/);
});

test('configured users are read, trimmed, filtered and deduplicated', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-static-config-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    filmaffinity: {
      users: [
        { name: ' Viewer ', userId: ' 123456 ' },
        { name: 'Viewer', userId: '123456' },
        { name: 'Missing ID' },
        null
      ]
    }
  }));

  assert.deepEqual(normalizeUsers(readConfig(configPath)), [
    { name: 'Viewer', userId: '123456' }
  ]);
});

test('CLI reports configuration failure with a nonzero exit code', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-static-config-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const scriptPath = path.join(directory, 'scripts', 'sync-static-data.js');
  fs.mkdirSync(path.dirname(scriptPath));
  fs.copyFileSync(path.join(__dirname, '..', 'scripts', 'sync-static-data.js'), scriptPath);
  fs.writeFileSync(path.join(directory, 'sync-filmaffinity.js'), 'module.exports = {};');
  fs.writeFileSync(path.join(directory, 'trailer-resolver.js'), 'module.exports = {};');
  fs.writeFileSync(path.join(directory, 'config.json'), '{"filmaffinity":{"users":[]}}');

  const result = spawnSync(process.execPath, [scriptPath], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No valid users found/);
  assert.match(result.stderr, /non-empty "name" and "userId"/);
  assert.equal(fs.existsSync(path.join(directory, 'public')), false);
});
