/**
 * Monaco web workers for Vite/Electron dev (avoids broken default worker URLs).
 * Import before the first Editor mount (see app-monaco-editor.tsx).
 */
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker"
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker"
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker"
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker"
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker"

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
        case "css":
        case "scss":
        case "less":
          return new cssWorker()
        case "html":
        case "handlebars":
        case "razor":
          return new htmlWorker()
        case "typescript":
        case "javascript":
          return new tsWorker()
        default:
          return new editorWorker()
      }
    },
  }
}
