/**
 * Custom Jest transformer for files that use Vite's import.meta.env.DEV.
 * Replaces the Vite-specific syntax with a plain boolean before TypeScript
 * compilation so that Jest (which runs in CommonJS mode) can parse the file.
 */
const { transformSync } = require('@swc/core');

module.exports = {
  process(sourceText, sourcePath) {
    const patched = sourceText.replace(/\bimport\.meta\.env\.DEV\b/g, 'false');
    const result = transformSync(patched, {
      filename: sourcePath,
      jsc: {
        target: 'es2022',
        parser: {
          syntax: 'typescript',
          decorators: true,
        },
      },
      module: { type: 'commonjs' },
      sourceMaps: 'inline',
    });
    return { code: result.code };
  },

  getCacheKey(fileData, filePath) {
    return `${filePath}::${fileData.length}`;
  },
};
