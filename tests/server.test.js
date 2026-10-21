const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { test, before, after } = require('node:test');

let server;
let origin;
before(async () => {
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  origin = await new Promise((resolve, reject) => {
    let output = '';
    server.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) resolve(match[0]);
    });
    server.on('error', reject);
    server.on('exit', (code) => reject(new Error(`Server exited with ${code}`)));
  });
});
after(async () => {
  if (server && server.exitCode === null) {
    const exited = once(server, 'exit');
    server.kill();
    await exited;
  }
});

test('bad URL encoding and null bytes return 400 without terminating the server', async () => {
  for (const pathname of ['/%E0%A4%A', '/%00']) {
    const response = await fetch(`${origin}${pathname}`);
    assert.equal(response.status, 400);
    assert((await response.json()).error);
  }
  assert.equal((await fetch(origin)).status, 200);
});

test('missing static assets and unknown users return 404', async () => {
  for (const pathname of ['/missing.js', '/api/library?userName=Unknown%20User']) {
    assert.equal((await fetch(`${origin}${pathname}`)).status, 404);
  }
});

test('the web manifest has the correct MIME type', async () => {
  const response = await fetch(`${origin}/site.webmanifest`);
  assert.equal(response.headers.get('content-type'), 'application/manifest+json; charset=utf-8');
  assert((await response.json()).name);
});
