const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['dist/**', '.playwright/**', 'node_modules/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { globals: globals.node },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }]
    }
  },
  {
    files: ['public/*.js'],
    languageOptions: { sourceType: 'script', globals: globals.browser }
  },
  {
    files: ['sync-filmaffinity.js', 'tests/*.js'],
    languageOptions: { globals: globals.browser }
  }
];
