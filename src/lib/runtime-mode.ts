import { getRendererTransport } from "@/services/transport"

/**
 * True when the renderer talks to a SimpleCRM server over HTTP (the server
 * edition / browser app). False in standalone Electron (sqlite/IPC) mode.
 *
 * Use this to hide UI that depends on server-only IPC channels (which only have
 * HTTP route builders, no Electron handlers) — e.g. user groups, full-inbox
 * import — so standalone users don't hit a missing-handler error path.
 */
export function isServerClientMode(): boolean {
  return getRendererTransport().kind === "http"
}
