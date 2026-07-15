import { parse, parseFragment, serialize, type DefaultTreeAdapterMap } from 'parse5';

export type EmailEvidenceConfidence = 'none' | 'low' | 'medium' | 'high' | 'verified';

export type EmailEvidenceActorClass =
  | 'system'
  | 'probable_human'
  | 'mail_proxy'
  | 'privacy_proxy'
  | 'security_scanner'
  | 'automated_unknown'
  | 'unknown';

export type EmailEvidenceClassification = Readonly<{
  version: 2;
  actorClass: EmailEvidenceActorClass;
  confidence: EmailEvidenceConfidence;
  reasons: readonly string[];
}>;

export type EmailTrackingNetworkContext = Readonly<{
  asn: number | null;
  networkName: string | null;
  providerClass:
    | 'google_fetcher'
    | 'apple_privacy'
    | 'proton_proxy'
    | 'security_vendor'
    | 'hosting_or_cloud'
    | 'unknown';
}>;

export type EmailEvidenceEventType =
  | 'queued'
  | 'sending'
  | 'smtp_accepted'
  | 'smtp_failed'
  | 'delayed'
  | 'bounced'
  | 'dsn_delivered'
  | 'mdn_displayed'
  | 'open_automated'
  | 'open_probable'
  | 'click_automated'
  | 'click'
  | 'replied'
  | 'revoked'
  | 'expired';

export type EmailEvidenceEvent = Readonly<{
  type: EmailEvidenceEventType;
  confidence: EmailEvidenceConfidence;
  occurredAt: string;
  automated: boolean;
}>;

export type EmailEvidenceSummary = Readonly<{
  transport: 'unknown' | 'queued' | 'sending' | 'smtp_accepted' | 'delayed' | 'failed' | 'bounced';
  delivery: 'unknown' | 'external_system_reached' | 'dsn_delivered';
  engagement: 'none' | 'automated_fetch' | 'probable_open' | 'link_interaction' | 'human_reply';
  confidence: EmailEvidenceConfidence;
  openCount: number;
  clickCount: number;
  automatedOpenCount: number;
  probableOpenCount: number;
  automatedClickCount: number;
  probableClickCount: number;
  firstOpenedAt: string | null;
  lastOpenedAt: string | null;
  firstClickedAt: string | null;
  lastClickedAt: string | null;
  repliedAt: string | null;
}>;

export type InboundEmailEvidence = Readonly<{
  type: 'bounced' | 'delayed' | 'dsn_delivered' | 'mdn_displayed' | 'replied';
  originalMessageId: string;
  candidateMessageIds: readonly string[];
  source: 'dsn' | 'mdn' | 'reply';
  confidence: 'medium' | 'high' | 'verified';
  suppressAutomation: boolean;
  metadata: Readonly<Record<string, string>>;
}>;

export type InstrumentedEmailLink = Readonly<{
  ordinal: number;
  targetUrl: string;
}>;

type HtmlAttribute = { name: string; value: string };
type HtmlNode = {
  nodeName: string;
  tagName?: string;
  attrs?: HtmlAttribute[];
  childNodes?: HtmlNode[];
  parentNode?: HtmlNode;
};

const MAX_TRACKED_LINKS = 1_000;
const MAX_TRACKED_TARGET_URL_LENGTH = 8_192;

export function instrumentEmailHtml(input: {
  html: string;
  openPixelUrl: string | null;
  trackingBaseUrl: string;
  createClickUrl?: (input: InstrumentedEmailLink) => string;
}): { html: string; trackedLinks: readonly InstrumentedEmailLink[] } {
  if (!input.html.trim()) return { html: input.html, trackedLinks: [] };

  const fragment = isHtmlDocument(input.html)
    ? parse(input.html) as unknown as HtmlNode
    : parseFragment(input.html) as unknown as HtmlNode;
  const trackedLinks: InstrumentedEmailLink[] = [];
  const trackingOrigin = safeUrl(input.trackingBaseUrl)?.origin ?? null;

  removeOpenPixels(fragment);

  visitHtmlNodes(fragment, (node) => {
    if (node.tagName?.toLowerCase() !== 'a' || !input.createClickUrl) return;
    if (trackedLinks.length >= MAX_TRACKED_LINKS) return;
    const attrs = node.attrs ?? [];
    const href = attrs.find((attribute) => attribute.name.toLowerCase() === 'href');
    if (!href || !isTrackableLink(href.value, attrs, trackingOrigin)) return;
    const link = { ordinal: trackedLinks.length, targetUrl: href.value };
    href.value = input.createClickUrl(link);
    trackedLinks.push(link);
  });

  if (input.openPixelUrl) {
    const pixelFragment = parseFragment(
      `<img data-simplecrm-open-pixel="1" src="${escapeHtmlAttribute(input.openPixelUrl)}" width="1" height="1" alt="" aria-hidden="true" style="display:block;width:1px;height:1px;border:0;opacity:0" />`,
    ) as unknown as HtmlNode;
    const pixel = pixelFragment.childNodes?.[0];
    if (pixel) {
      const parent = findFirstTag(fragment, 'body') ?? fragment;
      parent.childNodes ??= [];
      pixel.parentNode = parent;
      parent.childNodes.push(pixel);
    }
  }

  return {
    html: serialize(fragment as unknown as DefaultTreeAdapterMap['parentNode']),
    trackedLinks,
  };
}

export function classifyEmailTrackingRequest(input: {
  userAgent?: string | null;
  requestIp?: string | null;
  secondsSinceSmtpAccepted?: number | null;
  requestHeaders: Readonly<Record<string, string | undefined>>;
  interaction?: 'open' | 'click';
  networkContext?: EmailTrackingNetworkContext | null;
}): EmailEvidenceClassification & {
  automated: boolean;
  eventType: 'open_automated' | 'open_probable' | 'click_automated' | 'click';
  confidence: 'low' | 'medium';
} {
  const interaction = input.interaction ?? 'open';
  const userAgent = input.userAgent?.trim() ?? '';
  const headers = normalizeHeaderKeys(input.requestHeaders);

  const forwardedIp = (headers['x-forwarded-for'] ?? '').split(',')[0]?.trim() ?? '';
  const clientIp = input.requestIp === undefined ? forwardedIp : input.requestIp?.trim() ?? '';
  const immediate = input.secondsSinceSmtpAccepted !== null
    && input.secondsSinceSmtpAccepted !== undefined
    && input.secondsSinceSmtpAccepted >= 0
    && input.secondsSinceSmtpAccepted <= 5;

  if (/googleimageproxy/i.test(userAgent)) {
    return trackingClassification(interaction, 'mail_proxy', 'low', ['known_proxy_user_agent']);
  }
  if (/(?:proofpoint|mimecast|barracuda|messagelabs|safelinks|url defense|security scanner|link scanner|mailprotector|fireeye|trendmicro)/i.test(userAgent)) {
    return trackingClassification(interaction, 'security_scanner', 'low', ['known_scanner_user_agent']);
  }
  if (headers['x-apple-mail-privacy']) {
    return trackingClassification(interaction, 'privacy_proxy', 'low', ['known_proxy_header']);
  }
  if (headers['x-email-proxy']) {
    return trackingClassification(interaction, 'mail_proxy', 'low', ['known_proxy_header']);
  }
  if (/(?:prefetch|preview)/i.test(headers.purpose ?? headers['sec-purpose'] ?? '')) {
    return trackingClassification(interaction, 'automated_unknown', 'low', ['prefetch_header']);
  }

  const providerActor = verifiedProviderActor(input.networkContext?.providerClass ?? 'unknown');
  if (providerActor) {
    return trackingClassification(interaction, providerActor, 'low', ['known_provider_network']);
  }
  if (immediate && input.networkContext?.providerClass === 'hosting_or_cloud') {
    const actorClass = isGoogleNetwork(input.networkContext) ? 'mail_proxy' : 'automated_unknown';
    return trackingClassification(interaction, actorClass, 'low', ['immediate_infrastructure_fetch']);
  }
  if (immediate && /^17\./.test(clientIp) && /AppleWebKit/i.test(userAgent)) {
    return trackingClassification(interaction, 'privacy_proxy', 'low', ['immediate_infrastructure_fetch']);
  }
  if (immediate) {
    return trackingClassification(interaction, 'unknown', 'low', ['immediate_unattributed_fetch']);
  }

  if (!userAgent || requestIpScope(clientIp) !== 'public') {
    return trackingClassification(interaction, 'unknown', 'low', ['missing_client_identity']);
  }
  if (input.networkContext?.providerClass === 'hosting_or_cloud') {
    return trackingClassification(interaction, 'unknown', 'low', ['unattributed_infrastructure_network']);
  }
  return trackingClassification(interaction, 'probable_human', 'medium', []);
}

function trackingClassification(
  interaction: 'open' | 'click',
  actorClass: EmailEvidenceActorClass,
  confidence: 'low' | 'medium',
  reasons: readonly string[],
): EmailEvidenceClassification & {
  automated: boolean;
  eventType: 'open_automated' | 'open_probable' | 'click_automated' | 'click';
  confidence: 'low' | 'medium';
} {
  const automated = actorClass === 'mail_proxy'
    || actorClass === 'privacy_proxy'
    || actorClass === 'security_scanner'
    || actorClass === 'automated_unknown';
  return {
    version: 2,
    actorClass,
    confidence,
    reasons,
    automated,
    eventType: interaction === 'click'
      ? automated ? 'click_automated' : 'click'
      : automated ? 'open_automated' : 'open_probable',
  };
}

function verifiedProviderActor(
  providerClass: EmailTrackingNetworkContext['providerClass'],
): Extract<EmailEvidenceActorClass, 'mail_proxy' | 'privacy_proxy' | 'security_scanner'> | null {
  if (providerClass === 'google_fetcher') return 'mail_proxy';
  if (providerClass === 'apple_privacy' || providerClass === 'proton_proxy') return 'privacy_proxy';
  if (providerClass === 'security_vendor') return 'security_scanner';
  return null;
}

function isGoogleNetwork(context: EmailTrackingNetworkContext): boolean {
  return context.asn === 15169 && /(?:^|\W)google(?:\W|$)/i.test(context.networkName ?? '');
}

function requestIpScope(ip: string): 'public' | 'non_public' | 'unknown' {
  const ipv4 = parseIpv4Octets(ip);
  if (ipv4) return ipv4RequestScope(ipv4);
  const hextets = parseIpv6Hextets(ip);
  if (!hextets) return 'unknown';
  if (hextets.slice(0, 5).every((value) => value === 0) && hextets[5] === 0xffff) {
    return ipv4RequestScope([
      hextets[6]! >>> 8,
      hextets[6]! & 255,
      hextets[7]! >>> 8,
      hextets[7]! & 255,
    ]);
  }
  const first = hextets[0]!;
  if (
    hextets.every((value) => value === 0)
    || hextets.slice(0, 7).every((value) => value === 0) && hextets[7] === 1
    || (first & 0xfe00) === 0xfc00
    || (first & 0xffc0) === 0xfe80
    || (first & 0xff00) === 0xff00
    || (first === 0x2001 && hextets[1] === 0x0db8)
  ) return 'non_public';
  return 'public';
}

function ipv4RequestScope(octets: readonly number[]): 'public' | 'non_public' {
  const [first, second, third] = octets;
  if (
    first === 0
    || first === 10
    || first === 127
    || (first === 100 && second! >= 64 && second! <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second! >= 16 && second! <= 31)
    || (first === 192 && (second === 0 || second === 2 || second === 168))
    || (first === 198 && (second === 18 || second === 19 || second === 51))
    || (first === 203 && second === 0 && third === 113)
    || first! >= 224
  ) return 'non_public';
  return 'public';
}

function parseIpv4Octets(ip: string): readonly number[] | null {
  const parts = ip.split('.');
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
    ? parts.map(Number)
    : null;
}

function parseIpv6Hextets(ip: string): readonly number[] | null {
  const normalized = ip.toLowerCase();
  const dottedTail = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(normalized);
  const dotted = dottedTail ? parseIpv4Octets(dottedTail[2]!) : null;
  const expanded = dottedTail && dotted
    ? `${dottedTail[1]}${((dotted[0]! << 8) | dotted[1]!).toString(16)}:${((dotted[2]! << 8) | dotted[3]!).toString(16)}`
    : dottedTail ? null : normalized;
  if (!expanded) return null;
  const compressed = expanded.split('::');
  if (compressed.length > 2) return null;
  const left = parseIpv6Side(compressed[0]!);
  const right = parseIpv6Side(compressed[1] ?? '');
  if (!left || !right) return null;
  if (compressed.length === 1) return left.length === 8 ? left : null;
  const missing = 8 - left.length - right.length;
  return missing > 0 ? [...left, ...Array<number>(missing).fill(0), ...right] : null;
}

function parseIpv6Side(value: string): readonly number[] | null {
  if (!value) return [];
  const parts = value.split(':');
  return parts.every((part) => /^[0-9a-f]{1,4}$/.test(part))
    ? parts.map((part) => Number.parseInt(part, 16))
    : null;
}

export function buildEmailEvidenceSummary(events: readonly EmailEvidenceEvent[]): EmailEvidenceSummary {
  let transport: EmailEvidenceSummary['transport'] = 'unknown';
  let delivery: EmailEvidenceSummary['delivery'] = 'unknown';
  let engagement: EmailEvidenceSummary['engagement'] = 'none';
  let confidence: EmailEvidenceConfidence = 'none';
  let openCount = 0;
  let clickCount = 0;
  let automatedOpenCount = 0;
  let probableOpenCount = 0;
  let automatedClickCount = 0;
  let probableClickCount = 0;
  let firstOpenedAt: string | null = null;
  let lastOpenedAt: string | null = null;
  let firstClickedAt: string | null = null;
  let lastClickedAt: string | null = null;
  let repliedAt: string | null = null;

  const ordered = [...events].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  for (const event of ordered) {
    if (event.type !== 'revoked' && event.type !== 'expired') {
      confidence = higherConfidence(confidence, event.confidence);
    }
    if (event.type === 'queued') transport = 'queued';
    if (event.type === 'sending') transport = 'sending';
    if (event.type === 'smtp_accepted') transport = 'smtp_accepted';
    if (event.type === 'delayed') transport = 'delayed';
    if (event.type === 'smtp_failed') transport = 'failed';
    if (event.type === 'bounced') transport = 'bounced';
    if (event.type === 'dsn_delivered') delivery = 'dsn_delivered';

    if (event.type === 'open_automated' || event.type === 'open_probable') {
      openCount += 1;
      if (event.type === 'open_automated') automatedOpenCount += 1;
      else probableOpenCount += 1;
      firstOpenedAt ??= event.occurredAt;
      lastOpenedAt = event.occurredAt;
      if (delivery === 'unknown') delivery = 'external_system_reached';
      if (event.type === 'open_probable') {
        engagement = higherEngagement(engagement, 'probable_open');
      } else {
        engagement = higherEngagement(engagement, 'automated_fetch');
      }
    }
    if (event.type === 'click' || event.type === 'click_automated') {
      clickCount += 1;
      if (event.type === 'click_automated') automatedClickCount += 1;
      else probableClickCount += 1;
      firstClickedAt ??= event.occurredAt;
      lastClickedAt = event.occurredAt;
      if (delivery === 'unknown') delivery = 'external_system_reached';
      engagement = higherEngagement(
        engagement,
        event.type === 'click' ? 'link_interaction' : 'automated_fetch',
      );
    }
    if (event.type === 'mdn_displayed') {
      if (delivery === 'unknown') delivery = 'external_system_reached';
      engagement = higherEngagement(engagement, 'probable_open');
    }
    if (event.type === 'replied') {
      if (delivery === 'unknown') delivery = 'external_system_reached';
      engagement = 'human_reply';
      repliedAt = event.occurredAt;
    }
  }

  return {
    transport,
    delivery,
    engagement,
    confidence,
    openCount,
    clickCount,
    automatedOpenCount,
    probableOpenCount,
    automatedClickCount,
    probableClickCount,
    firstOpenedAt,
    lastOpenedAt,
    firstClickedAt,
    lastClickedAt,
    repliedAt,
  };
}

export function detectInboundEmailEvidence(input: {
  rawHeaders?: string | null;
  bodyText?: string | null;
  reportFields?: string | null;
  embeddedMessageHeaders?: string | null;
  inReplyTo?: string | null;
  referencesHeader?: string | null;
}): readonly InboundEmailEvidence[] {
  const headers = parseRfcFields(input.rawHeaders, 64 * 1024);
  const reportFields = parseRfcFields(
    [input.reportFields, input.bodyText]
      .filter((value): value is string => Boolean(value?.trim()))
      .join('\r\n'),
    512 * 1024,
  );
  const embeddedFields = parseRfcFields(input.embeddedMessageHeaders, 64 * 1024);
  const contentType = firstField(headers, 'content-type').toLowerCase();
  const originalMessageId = normalizeMessageId(firstField(reportFields, 'original-message-id'))
    ?? normalizeMessageId(firstField(embeddedFields, 'message-id'));
  const action = firstField(reportFields, 'action').toLowerCase();
  const status = firstField(reportFields, 'status').toLowerCase();
  const disposition = dispositionResult(firstField(reportFields, 'disposition'));

  const looksLikeDsn = isMultipartReport(contentType, 'delivery-status');
  if (looksLikeDsn && originalMessageId) {
    const type = dsnEventType(action, status);
    if (type) {
      return [{
        type,
        originalMessageId,
        candidateMessageIds: [originalMessageId],
        source: 'dsn',
        confidence: 'high',
        suppressAutomation: true,
        metadata: {
          ...(action ? { action } : {}),
          ...(status ? { status } : {}),
        },
      }];
    }
  }

  const looksLikeMdn = isMultipartReport(contentType, 'disposition-notification');
  if (looksLikeMdn && originalMessageId && disposition === 'displayed') {
    return [{
      type: 'mdn_displayed',
      originalMessageId,
      candidateMessageIds: [originalMessageId],
      source: 'mdn',
      confidence: 'medium',
      suppressAutomation: true,
      metadata: { disposition },
    }];
  }

  if (isAutomatedInbound(headers)) return [];
  const replyMessageIds = replyCorrelationMessageIds(input.inReplyTo, input.referencesHeader);
  const replyMessageId = replyMessageIds[0];
  if (!replyMessageId) return [];
  return [{
    type: 'replied',
    originalMessageId: replyMessageId,
    candidateMessageIds: replyMessageIds,
    source: 'reply',
    confidence: 'verified',
    suppressAutomation: false,
    metadata: {},
  }];
}

function isMultipartReport(contentType: string, reportType: string): boolean {
  return /\bmultipart\/report\b/i.test(contentType)
    && new RegExp(`\\breport-type\\s*=\\s*"?${reportType}"?\\b`, 'i').test(contentType);
}

export function emailEvidenceWorkflowVariables(input: {
  tracked: boolean;
  events: readonly EmailEvidenceEvent[];
}): Readonly<Record<string, string | number | boolean | null>> {
  const summary = buildEmailEvidenceSummary(input.events);
  return emailEvidenceSummaryWorkflowVariables({ tracked: input.tracked, summary });
}

export function emailEvidenceSummaryWorkflowVariables(input: {
  tracked: boolean;
  summary: EmailEvidenceSummary;
}): Readonly<Record<string, string | number | boolean | null>> {
  const { summary } = input;
  return {
    'tracking.tracked': input.tracked,
    'tracking.transport': summary.transport,
    'tracking.delivery': summary.delivery,
    'tracking.engagement': summary.engagement,
    'tracking.confidence': summary.confidence,
    'tracking.open_count': summary.openCount,
    'tracking.click_count': summary.clickCount,
    'tracking.automated_open_count': summary.automatedOpenCount,
    'tracking.probable_open_count': summary.probableOpenCount,
    'tracking.automated_click_count': summary.automatedClickCount,
    'tracking.probable_click_count': summary.probableClickCount,
    'tracking.first_opened_at': summary.firstOpenedAt,
    'tracking.last_opened_at': summary.lastOpenedAt,
    'tracking.first_clicked_at': summary.firstClickedAt,
    'tracking.last_clicked_at': summary.lastClickedAt,
    'tracking.replied_at': summary.repliedAt,
    'tracking.replied': summary.repliedAt !== null,
  };
}

function visitHtmlNodes(node: HtmlNode, visitor: (node: HtmlNode) => void): void {
  visitor(node);
  for (const child of node.childNodes ?? []) visitHtmlNodes(child, visitor);
}

function findFirstTag(node: HtmlNode, tagName: string): HtmlNode | null {
  if (node.tagName?.toLowerCase() === tagName) return node;
  for (const child of node.childNodes ?? []) {
    const found = findFirstTag(child, tagName);
    if (found) return found;
  }
  return null;
}

function removeOpenPixels(node: HtmlNode): void {
  if (!node.childNodes) return;
  node.childNodes = node.childNodes.filter((child) => (
    !child.attrs?.some((attribute) => attribute.name.toLowerCase() === 'data-simplecrm-open-pixel')
  ));
  for (const child of node.childNodes) removeOpenPixels(child);
}

function isTrackableLink(
  href: string,
  attrs: readonly HtmlAttribute[],
  trackingOrigin: string | null,
): boolean {
  if (href.length > MAX_TRACKED_TARGET_URL_LENGTH) return false;
  if (attrs.some((attribute) => (
    attribute.name.toLowerCase() === 'data-simplecrm-track'
    && attribute.value.trim().toLowerCase() === 'off'
  ))) return false;
  const url = safeUrl(href);
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) return false;
  if (trackingOrigin && url.origin === trackingOrigin && url.pathname.startsWith('/t/')) return false;
  return true;
}

function safeUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isHtmlDocument(value: string): boolean {
  return /<!doctype\s+html\b|<html(?:\s|>)/i.test(value);
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function normalizeHeaderKeys(
  headers: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
}

function parseRfcFields(value: string | null | undefined, maxLength: number): Map<string, string[]> {
  const fields = new Map<string, string[]>();
  if (!value) return fields;
  const bounded = value.slice(0, maxLength).replace(/\r?\n[ \t]+/g, ' ');
  for (const line of bounded.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9-]{1,64}):[ \t]*(.*)$/.exec(line);
    if (!match) continue;
    const name = match[1]!.toLowerCase();
    const fieldValue = match[2]!.trim().slice(0, 2_048);
    const existing = fields.get(name) ?? [];
    if (existing.length < 20) existing.push(fieldValue);
    fields.set(name, existing);
  }
  return fields;
}

function firstField(fields: ReadonlyMap<string, readonly string[]>, name: string): string {
  return fields.get(name)?.[0]?.trim() ?? '';
}

function normalizeMessageId(value: string | null | undefined): string | null {
  const match = /<[^<>\s\r\n]{1,996}>/.exec(value?.trim() ?? '');
  return match?.[0] ?? null;
}

function replyCorrelationMessageIds(
  inReplyTo: string | null | undefined,
  referencesHeader: string | null | undefined,
): string[] {
  const direct = (inReplyTo ?? '').match(/<[^<>\s\r\n]{1,996}>/g) ?? [];
  const references = (referencesHeader ?? '').match(/<[^<>\s\r\n]{1,996}>/g) ?? [];
  return [...new Set([...direct, ...references.reverse()])].slice(0, 50);
}

function dsnEventType(
  action: string,
  status: string,
): InboundEmailEvidence['type'] | null {
  if (action === 'failed' || status.startsWith('5.')) return 'bounced';
  if (action === 'delayed' || status.startsWith('4.')) return 'delayed';
  if (action === 'delivered' && status.startsWith('2.')) return 'dsn_delivered';
  return null;
}

function dispositionResult(value: string): string {
  const parts = value.split(';');
  const result = parts[parts.length - 1]?.trim().toLowerCase() ?? '';
  return /^[a-z-]{1,64}$/.test(result) ? result : '';
}

function isAutomatedInbound(headers: ReadonlyMap<string, readonly string[]>): boolean {
  const autoSubmitted = firstField(headers, 'auto-submitted').toLowerCase();
  if (autoSubmitted && autoSubmitted !== 'no') return true;
  if (firstField(headers, 'list-id')) return true;
  return /^(?:bulk|junk|list)$/i.test(firstField(headers, 'precedence'));
}

const CONFIDENCE_RANK: Readonly<Record<EmailEvidenceConfidence, number>> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  verified: 4,
};

function higherConfidence(
  current: EmailEvidenceConfidence,
  candidate: EmailEvidenceConfidence,
): EmailEvidenceConfidence {
  return CONFIDENCE_RANK[candidate] > CONFIDENCE_RANK[current] ? candidate : current;
}

const ENGAGEMENT_RANK: Readonly<Record<EmailEvidenceSummary['engagement'], number>> = {
  none: 0,
  automated_fetch: 1,
  probable_open: 2,
  link_interaction: 3,
  human_reply: 4,
};

function higherEngagement(
  current: EmailEvidenceSummary['engagement'],
  candidate: EmailEvidenceSummary['engagement'],
): EmailEvidenceSummary['engagement'] {
  return ENGAGEMENT_RANK[candidate] > ENGAGEMENT_RANK[current] ? candidate : current;
}
