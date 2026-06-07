/**
 * Monaco web workers for Vite/Electron dev (avoids broken default worker URLs).
 * Import before the first Editor mount (see app-monaco-editor.tsx).
 */
// Only the workers for languages we actually load (see monaco-curated.ts):
// JSON has a real language service worker; JavaScript/Python/Markdown are
// tokenizer-only (basic-languages) and use the default editor worker. We do not
// import the css/html/typescript workers — those languages aren't bundled, so
// pulling their worker entries would needlessly re-add build weight.
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker"
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker"

type MonacoEnvironmentLike = {
  getWorker: (workerId: string, label: string) => Worker
}

const env = globalThis as typeof globalThis & {
  MonacoEnvironment?: MonacoEnvironmentLike
}

if (!env.MonacoEnvironment) {
  env.MonacoEnvironment = {
    getWorker(_workerId, label) {
      switch (label) {
        case "json":
          return new jsonWorker()
        default:
          return new editorWorker()
      }
    },
  }
}
