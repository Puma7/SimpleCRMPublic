import babelParser from '@babel/eslint-parser';

const ignores = [
  'dist/**',
  'dist-electron/**',
  'dist-build/**',
  'node_modules/**',
  'coverage/**',
  '.playwright-cli/**',
];

const baseParserOptions = {
  requireConfigFile: false,
  ecmaVersion: 'latest',
  sourceType: 'module',
};

export default [
  { ignores },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        ...baseParserOptions,
        babelOptions: { parserOpts: { plugins: ['typescript'] } },
      },
    },
  },
  {
    files: ['**/*.tsx'],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        ...baseParserOptions,
        babelOptions: { parserOpts: { plugins: ['typescript', 'jsx'] } },
      },
    },
  },
];
