/**
 * Curated Monaco bundle — the editor with ALL features but only the four
 * languages the app actually uses (JSON, JavaScript, Python, Markdown).
 *
 * Importing the `monaco-editor` package entry (`editor.main.js`) pulls in ~80
 * basic-languages (abap, solidity, powerquery, …). Each becomes its own chunk
 * and Rollup holds them all in memory during the build, which pushed peak RSS
 * to ~3.2 GB and OOM-killed `vite build` on 4 GB hosts.
 *
 * `editor.all.js` provides every editor feature (find, folding, suggest, …)
 * WITHOUT any language; we then add only the four contributions we need. This
 * keeps the editor fully functional for our use (Experten-JSON, code nodes,
 * knowledge markdown) while cutting build memory and bundle size dramatically.
 *
 * `loader.config({ monaco })` in app-monaco-editor.tsx points
 * `@monaco-editor/react` at this module instead of the full package.
 */
import "monaco-editor/esm/vs/editor/editor.all.js"

// Languages used in the UI (see AppMonacoEditor call sites):
//  - json     → ExpertJsonEditor (rich service + worker)
//  - javascript / python → workflow code nodes (CodeConfigFields)
//  - markdown → knowledge base editor
import "monaco-editor/esm/vs/language/json/monaco.contribution"
import "monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution"
import "monaco-editor/esm/vs/basic-languages/python/python.contribution"
import "monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution"

export * from "monaco-editor/esm/vs/editor/editor.api.js"
