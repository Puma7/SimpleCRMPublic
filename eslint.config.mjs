import tseslint from 'typescript-eslint';

// Minimal flat-config stub. The previous config extended `next/core-web-vitals`
// and `next/typescript` but never had `next` or `eslint-config-next` installed,
// so `pnpm lint` failed in both pre-merge branches. This stub registers the
// typescript-eslint plugin so existing inline `eslint-disable-next-line
// @typescript-eslint/...` comments resolve to known rules, but enables no
// rules itself. A proper ruleset is a separate follow-up.
export default tseslint.config({
  files: ['**/*.{ts,tsx}'],
  plugins: { '@typescript-eslint': tseslint.plugin },
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
  },
  ignores: [
    'dist/**',
    'dist-electron/**',
    'dist-build/**',
    'node_modules/**',
    'coverage/**',
    '.playwright-cli/**',
  ],
});
