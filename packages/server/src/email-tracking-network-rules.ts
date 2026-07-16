import type { EmailTrackingNetworkContext } from '@simplecrm/core';

import type { EmailTrackingIpInsight } from './email-tracking-ip-intelligence';

const HOSTING_ASNS = new Set([13335, 14061, 14618, 15169, 16276, 16509, 24940, 8075]);

export function emailTrackingNetworkContext(
  insight: EmailTrackingIpInsight,
): EmailTrackingNetworkContext {
  const networkName = insight.networkName?.trim() || null;
  return {
    asn: insight.asn,
    networkName,
    providerClass: providerClass(insight.scope, insight.asn, networkName),
  };
}

function providerClass(
  scope: EmailTrackingIpInsight['scope'],
  asn: number | null,
  networkName: string | null,
): EmailTrackingNetworkContext['providerClass'] {
  if (scope !== 'public' || !networkName) return 'unknown';
  if (/(?:proofpoint|mimecast|barracuda|messagelabs|fireeye|trend\s*micro)/i.test(networkName)) {
    return 'security_vendor';
  }
  if (/(?:proton).*(?:mail|proxy|privacy)|(?:mail|proxy|privacy).*(?:proton)/i.test(networkName)) {
    return 'proton_proxy';
  }
  if (/(?:apple).*(?:mail privacy|private relay)|(?:mail privacy|private relay).*(?:apple)/i.test(networkName)) {
    return 'apple_privacy';
  }
  if (
    asn === 15169
    && /google/i.test(networkName)
    && /(?:mail|image|fetch|proxy)/i.test(networkName)
  ) return 'google_fetcher';
  if (
    HOSTING_ASNS.has(asn ?? -1)
    || /(?:amazon|aws|azure|cloudflare|digitalocean|google|hetzner|microsoft|ovh)/i.test(networkName)
  ) return 'hosting_or_cloud';
  return 'unknown';
}
