const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

for (const directory of ['.', 'public', 'scripts', 'tests']) {
  for (const name of fs.readdirSync(directory).filter((name) => name.endsWith('.js'))) {
    execFileSync(process.execPath, ['--check', path.join(directory, name)], { stdio: 'inherit' });
  }
}
