/**
 * Renderer-facing shape of the DMARC statistics snapshot returned by the
 * `email:list-dmarc-stats` IPC channel. Mirrors the server-side
 * `DmarcReportingSnapshot` (packages/server) so the stats page has a typed
 * result without importing server code. Server-edition only.
 */
export type DmarcStatsSnapshot = {
  windowDays: number
  totals: {
    reports: number
    records: number
    messages: number
    passMessages: number
    failMessages: number
    rejectMessages: number
    quarantineMessages: number
    unauthorizedSources: number
    domains: number
  }
  timeSeries: Array<{
    date: string
    pass: number
    fail: number
    reject: number
    quarantine: number
  }>
  topSourceIps: Array<{
    sourceIp: string
    messages: number
    passMessages: number
    failMessages: number
  }>
  topFromDomains: Array<{
    headerFrom: string
    messages: number
    failMessages: number
  }>
  dispositions: Array<{
    disposition: string
    messages: number
  }>
  unauthorizedSources: Array<{
    sourceIp: string
    headerFrom: string | null
    domain: string
    orgName: string
    messages: number
    lastSeen: string
  }>
}
