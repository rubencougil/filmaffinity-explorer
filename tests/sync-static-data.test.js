const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
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

function createPublishFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-static-publish-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const repository = path.join(directory, 'repository');
  const remote = path.join(directory, 'remote.git');
  fs.mkdirSync(path.join(repository, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(repository, 'public', 'data'), { recursive: true });
  fs.copyFileSync(
    path.join(__dirname, '..', 'scripts', 'sync-static-data.js'),
    path.join(repository, 'scripts', 'sync-static-data.js')
  );
  fs.writeFileSync(path.join(repository, 'config.json'), JSON.stringify({
    filmaffinity: { users: [{ name: 'Viewer', userId: '123456' }] }
  }));
  fs.writeFileSync(path.join(repository, 'sync-filmaffinity.js'), `
    exports.syncFilmaffinity = async () => ({
      ratings: [{ title: 'Movie', trailerVideoId: 'existing' }], count: 1
    });
  `);
  fs.writeFileSync(path.join(repository, 'trailer-resolver.js'), 'module.exports = {};');
  fs.writeFileSync(path.join(repository, 'public', 'data', 'libraries.json'), '{"libraries":[]}');
  fs.writeFileSync(path.join(repository, 'unrelated.txt'), 'original');

  const git = (...args) => execFileSync('git', args, {
    cwd: repository,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
  git('init', '--initial-branch=main');
  git('config', 'user.name', 'Sync Test');
  git('config', 'user.email', 'sync@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.hooksPath', path.join(directory, 'no-hooks'));
  git('add', '.');
  git('commit', '-m', 'Initial fixture');
  git('init', '--bare', '--initial-branch=main', remote);
  git('remote', 'add', 'origin', remote);
  git('push', 'origin', 'main');

  const run = (...args) => spawnSync(process.execPath, ['scripts/sync-static-data.js', ...args], {
    cwd: repository,
    encoding: 'utf8'
  });
  return { repository, remote, git, run };
}

test('--publish commits and pushes only static data, preserving unrelated staged changes', (t) => {
  const { repository, remote, git, run } = createPublishFixture(t);
  fs.writeFileSync(path.join(repository, 'unrelated.txt'), 'staged change');
  git('add', 'unrelated.txt');
  fs.writeFileSync(path.join(repository, 'untracked.txt'), 'keep local');

  const result = run('--publish');

  assert.equal(result.status, 0, result.stderr);
  assert.equal(git('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'), 'public/data/libraries.json');
  assert.equal(git('diff', '--cached', '--name-only'), 'unrelated.txt');
  assert.equal(git('show', 'HEAD:unrelated.txt'), 'original');
  assert.equal(fs.readFileSync(path.join(repository, 'untracked.txt'), 'utf8'), 'keep local');
  assert.equal(git('--git-dir', remote, 'rev-parse', 'main'), git('rev-parse', 'HEAD'));
});

test('sync without --publish stays local and works outside main', (t) => {
  const { git, run } = createPublishFixture(t);
  git('switch', '-c', 'feature');
  const before = git('rev-parse', 'HEAD');

  const result = run();

  assert.equal(result.status, 0, result.stderr);
  assert.equal(git('rev-parse', 'HEAD'), before);
  assert.equal(git('diff', '--name-only'), 'public/data/libraries.json');
});

test('--publish refuses non-main and detached HEAD before updating data', (t) => {
  const { git, run } = createPublishFixture(t);
  const before = git('rev-parse', 'HEAD');
  git('switch', '-c', 'feature');

  for (const detached of [false, true]) {
    if (detached) git('switch', '--detach');
    const result = run('--publish');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Publishing requires the main branch/);
    assert.equal(git('rev-parse', 'HEAD'), before);
    assert.equal(git('status', '--porcelain'), '');
  }
});

test('failed sync does not commit or push', (t) => {
  const { repository, remote, git, run } = createPublishFixture(t);
  const before = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(repository, 'sync-filmaffinity.js'), `
    exports.syncFilmaffinity = async () => { throw new Error('Sync failed'); };
  `);

  const result = run('--publish');

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Sync failed/);
  assert.equal(git('rev-parse', 'HEAD'), before);
  assert.equal(git('--git-dir', remote, 'rev-parse', 'main'), before);
  assert.equal(git('diff', '--name-only', '--', 'public/data/libraries.json'), '');
});

test('rejected push fails without overwriting remote history or losing the local commit', (t) => {
  const { remote, git, run } = createPublishFixture(t);
  const remoteCommit = git('commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', 'Remote-only commit');
  git('push', 'origin', `${remoteCommit}:refs/heads/main`);

  const result = run('--publish');

  assert.equal(result.status, 1);
  assert.match(result.stderr, /rejected/);
  assert.equal(git('--git-dir', remote, 'rev-parse', 'main'), remoteCommit);
  assert.notEqual(git('rev-parse', 'HEAD'), remoteCommit);
  assert.equal(git('log', '-1', '--format=%s'), 'Update static FilmAffinity data');
  assert.equal(git('status', '--porcelain'), '');
});
