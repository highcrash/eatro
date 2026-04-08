// @ts-check
const base = require('./eslint-base');

/** @type {import('eslint').Linter.Config[]} */
module.exports = [
  ...base,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
];
