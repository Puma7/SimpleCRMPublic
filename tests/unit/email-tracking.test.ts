import {
  buildEmailEvidenceSummary,
  classifyEmailTrackingRequest,
  detectInboundEmailEvidence,
  emailEvidenceWorkflowVariables,
  instrumentEmailHtml,
  type EmailEvidenceEvent,
} from '../../packages/core/src/email';

describe('email evidence tracking core', () => {
  test('instruments only eligible http(s) links and appends one open pixel', () => {
    const result = instrumentEmailHtml({
      html: '<p><a href="https://customer.example/invoice?id=7">Rechnung</a> <a href="mailto:help@example.com">Hilfe</a> <a href="#top">Oben</a></p>',
      openPixelUrl: 'https://crm.example/t/o/open-token.gif',
      createClickUrl: ({ ordinal, targetUrl }) => `https://crm.example/t/c/click-${ordinal}?for=${encodeURIComponent(targetUrl)}`,
      trackingBaseUrl: 'https://crm.example',
    });

    expect(result.trackedLinks).toEqual([
      { ordinal: 0, targetUrl: 'https://customer.example/invoice?id=7' },
    ]);
    expect(result.html).toContain('href="https://crm.example/t/c/click-0?for=https%3A%2F%2Fcustomer.example%2Finvoice%3Fid%3D7"');
    expect(result.html).toContain('href="mailto:help@example.com"');
    expect(result.html).toContain('href="#top"');
    expect(result.html.match(/data-simplecrm-open-pixel/g)).toHaveLength(1);
  });

  test('does not double-wrap tracking links or opt-out links', () => {
    const result = instrumentEmailHtml({
      html: '<a href="https://crm.example/t/c/already">Alt</a><a data-simplecrm-track="off" href="https://customer.example/private">Privat</a>',
      openPixelUrl: null,
      createClickUrl: ({ ordinal }) => `https://crm.example/t/c/${ordinal}`,
      trackingBaseUrl: 'https://crm.example',
    });

    expect(result.trackedLinks).toEqual([]);
    expect(result.html).toContain('href="https://crm.example/t/c/already"');
    expect(result.html).toContain('href="https://customer.example/private"');
  });

  test('replaces stale SimpleCRM pixels and leaves overlong links untouched', () => {
    const overlong = `https://customer.example/${'x'.repeat(8_200)}`;
    const result = instrumentEmailHtml({
      html: `<p><a href="${overlong}">Lang</a><img data-simplecrm-open-pixel="1" src="https://old.example/t/o/stale.gif"></p>`,
      openPixelUrl: 'https://crm.example/t/o/current.gif',
      createClickUrl: ({ ordinal }) => `https://crm.example/t/c/${ordinal}`,
      trackingBaseUrl: 'https://crm.example',
    });

    expect(result.trackedLinks).toEqual([]);
    expect(result.html).toContain(overlong);
    expect(result.html).not.toContain('old.example');
    expect(result.html.match(/data-simplecrm-open-pixel/g)).toHaveLength(1);
    expect(result.html).toContain('https://crm.example/t/o/current.gif');
  });

  test('preserves complete HTML document structure while instrumenting the body', () => {
    const result = instrumentEmailHtml({
      html: '<!DOCTYPE html><html lang="de"><head><title>Rechnung</title></head><body><a href="https://customer.example/invoice">Öffnen</a></body></html>',
      openPixelUrl: 'https://crm.example/t/o/current.gif',
      createClickUrl: ({ ordinal }) => `https://crm.example/t/c/${ordinal}`,
      trackingBaseUrl: 'https://crm.example',
    });

    expect(result.html.toLowerCase()).toContain('<!doctype html>');
    expect(result.html).toContain('<html lang="de"><head><title>Rechnung</title></head><body>');
    expect(result.html).toContain('href="https://crm.example/t/c/0"');
    expect(result.html.match(/data-simplecrm-open-pixel/g)).toHaveLength(1);
    expect(result.html).toContain('</body></html>');
  });

  test('classifies immediate proxy/scanner requests as automated evidence', () => {
    expect(classifyEmailTrackingRequest({
      userAgent: 'Mozilla/5.0 AppleWebKit/605.1.15 (KHTML, like Gecko)',
      secondsSinceSmtpAccepted: 2,
      requestIp: '17.58.10.2',
      requestHeaders: {},
    })).toMatchObject({ automated: true, eventType: 'open_automated', confidence: 'low' });

    expect(classifyEmailTrackingRequest({
      userAgent: 'Mozilla/5.0 AppleWebKit/605.1.15 (KHTML, like Gecko)',
      secondsSinceSmtpAccepted: 2,
      requestIp: '203.0.113.9',
      requestHeaders: { 'x-forwarded-for': '17.58.10.2' },
    })).toMatchObject({ automated: false, eventType: 'open_probable' });

    expect(classifyEmailTrackingRequest({
      userAgent: 'Proofpoint URL Defense Scanner',
      secondsSinceSmtpAccepted: 600,
      requestHeaders: {},
      interaction: 'click',
    })).toMatchObject({ automated: true, eventType: 'click_automated', confidence: 'low' });
  });

  test('keeps transport, delivery and engagement evidence separate', () => {
    const events: EmailEvidenceEvent[] = [
      event('queued', 'none', '2026-07-13T08:00:00.000Z'),
      event('smtp_accepted', 'low', '2026-07-13T08:00:01.000Z'),
      event('open_automated', 'low', '2026-07-13T08:00:03.000Z'),
      event('click', 'medium', '2026-07-13T09:00:00.000Z'),
      event('replied', 'verified', '2026-07-13T10:00:00.000Z'),
    ];

    expect(buildEmailEvidenceSummary(events)).toMatchObject({
      transport: 'smtp_accepted',
      delivery: 'external_system_reached',
      engagement: 'human_reply',
      confidence: 'verified',
      openCount: 1,
      clickCount: 1,
      repliedAt: '2026-07-13T10:00:00.000Z',
    });
  });

  test('a later bounce wins over SMTP acceptance without inventing engagement', () => {
    expect(buildEmailEvidenceSummary([
      event('smtp_accepted', 'low', '2026-07-13T08:00:00.000Z'),
      event('bounced', 'high', '2026-07-13T08:05:00.000Z'),
    ])).toMatchObject({
      transport: 'bounced',
      delivery: 'unknown',
      engagement: 'none',
      confidence: 'high',
    });
  });

  test('does not promote evidence confidence for administrative lifecycle events', () => {
    expect(buildEmailEvidenceSummary([
      event('smtp_accepted', 'low', '2026-07-13T08:00:00.000Z'),
      event('revoked', 'verified', '2026-07-13T08:05:00.000Z'),
    ])).toMatchObject({
      transport: 'smtp_accepted',
      confidence: 'low',
    });
  });

  test('detects structured delivery failures without retaining recipient details', () => {
    const evidence = detectInboundEmailEvidence({
      rawHeaders: [
        'Content-Type: multipart/report; report-type=delivery-status',
        'Auto-Submitted: auto-generated',
      ].join('\r\n'),
      bodyText: [
        'Reporting-MTA: dns; mx.example.test',
        '',
        'Original-Message-ID: <invoice-17@crm.example>',
        'Final-Recipient: rfc822; private.customer@example.test',
        'Action: failed',
        'Status: 5.1.1',
        'Diagnostic-Code: smtp; 550 private.customer@example.test unknown',
      ].join('\r\n'),
      inReplyTo: null,
      referencesHeader: null,
    });

    expect(evidence).toEqual([{
      type: 'bounced',
      originalMessageId: '<invoice-17@crm.example>',
      candidateMessageIds: ['<invoice-17@crm.example>'],
      source: 'dsn',
      confidence: 'high',
      suppressAutomation: true,
      metadata: { action: 'failed', status: '5.1.1' },
    }]);
    expect(JSON.stringify(evidence)).not.toContain('private.customer');
  });

  test('does not interpret ordinary message text as a delivery or read receipt', () => {
    expect(detectInboundEmailEvidence({
      rawHeaders: 'Content-Type: text/plain; charset=utf-8',
      bodyText: [
        'Original-Message-ID: <invoice-17@crm.example>',
        'Action: failed',
        'Status: 5.1.1',
        'Disposition: manual-action/MDN-sent-manually; displayed',
      ].join('\r\n'),
      inReplyTo: null,
      referencesHeader: null,
    })).toEqual([]);
  });

  test('correlates standard DSNs through the attached original message headers', () => {
    expect(detectInboundEmailEvidence({
      rawHeaders: 'Content-Type: multipart/report; report-type=delivery-status',
      bodyText: 'Action: failed\r\nStatus: 5.1.1',
      embeddedMessageHeaders: [
        'From: sender@example.test',
        'Message-ID: <invoice-embedded@crm.example>',
        'Subject: Rechnung',
      ].join('\r\n'),
      inReplyTo: null,
      referencesHeader: null,
    })).toEqual([expect.objectContaining({
      type: 'bounced',
      originalMessageId: '<invoice-embedded@crm.example>',
      source: 'dsn',
    })]);
  });

  test('detects displayed MDNs as a distinct, non-human signal', () => {
    expect(detectInboundEmailEvidence({
      rawHeaders: 'Content-Type: multipart/report; report-type=disposition-notification',
      bodyText: [
        'Original-Message-ID: <reminder-2@crm.example>',
        'Disposition: manual-action/MDN-sent-manually; displayed',
      ].join('\r\n'),
      inReplyTo: null,
      referencesHeader: null,
    })).toEqual([{
      type: 'mdn_displayed',
      originalMessageId: '<reminder-2@crm.example>',
      candidateMessageIds: ['<reminder-2@crm.example>'],
      source: 'mdn',
      confidence: 'medium',
      suppressAutomation: true,
      metadata: { disposition: 'displayed' },
    }]);
  });

  test('detects displayed MDNs from the machine-readable report attachment', () => {
    expect(detectInboundEmailEvidence({
      rawHeaders: 'Content-Type: multipart/report; report-type=disposition-notification',
      bodyText: 'Your message was displayed.',
      reportFields: [
        'Original-Message-ID: <reminder-report@crm.example>',
        'Disposition: manual-action/MDN-sent-manually; displayed',
      ].join('\r\n'),
      inReplyTo: null,
      referencesHeader: null,
    })).toEqual([expect.objectContaining({
      type: 'mdn_displayed',
      originalMessageId: '<reminder-report@crm.example>',
      source: 'mdn',
    })]);
  });

  test('combines machine-readable report fields with fallback body fields', () => {
    expect(detectInboundEmailEvidence({
      rawHeaders: 'Content-Type: multipart/report; report-type=disposition-notification',
      bodyText: 'Original-Message-ID: <reminder-split@crm.example>',
      reportFields: 'Disposition: manual-action/MDN-sent-manually; displayed',
      inReplyTo: null,
      referencesHeader: null,
    })).toEqual([expect.objectContaining({
      type: 'mdn_displayed',
      originalMessageId: '<reminder-split@crm.example>',
      source: 'mdn',
    })]);
  });

  test('counts only non-automated replies as verified engagement', () => {
    expect(detectInboundEmailEvidence({
      rawHeaders: 'From: customer@example.test',
      bodyText: 'Danke, ich kümmere mich darum.',
      inReplyTo: '<reminder-3@crm.example>',
      referencesHeader: '<older@crm.example> <reminder-3@crm.example>',
    })).toEqual([{
      type: 'replied',
      originalMessageId: '<reminder-3@crm.example>',
      candidateMessageIds: ['<reminder-3@crm.example>', '<older@crm.example>'],
      source: 'reply',
      confidence: 'verified',
      suppressAutomation: false,
      metadata: {},
    }]);

    expect(detectInboundEmailEvidence({
      rawHeaders: 'Auto-Submitted: auto-replied',
      bodyText: 'Abwesenheitsnotiz',
      inReplyTo: '<reminder-3@crm.example>',
      referencesHeader: null,
    })).toEqual([]);
  });

  test('keeps referenced outbound message ids as reply-correlation candidates', () => {
    expect(detectInboundEmailEvidence({
      rawHeaders: 'From: customer@example.test',
      bodyText: 'Noch eine Rückfrage',
      inReplyTo: '<customer-message@example.test>',
      referencesHeader: '<outbound-tracked@crm.example> <customer-message@example.test>',
    })).toEqual([expect.objectContaining({
      type: 'replied',
      originalMessageId: '<customer-message@example.test>',
      candidateMessageIds: [
        '<customer-message@example.test>',
        '<outbound-tracked@crm.example>',
      ],
    })]);
  });

  test('maps the current evidence snapshot to stable workflow variables', () => {
    expect(emailEvidenceWorkflowVariables({
      tracked: true,
      events: [
        event('smtp_accepted', 'low', '2026-07-13T08:00:00.000Z'),
        event('open_probable', 'medium', '2026-07-13T08:03:00.000Z'),
      ],
    })).toEqual(expect.objectContaining({
      'tracking.tracked': true,
      'tracking.transport': 'smtp_accepted',
      'tracking.delivery': 'external_system_reached',
      'tracking.engagement': 'probable_open',
      'tracking.open_count': 1,
      'tracking.click_count': 0,
      'tracking.last_opened_at': '2026-07-13T08:03:00.000Z',
      'tracking.replied': false,
    }));
  });
});

function event(
  type: EmailEvidenceEvent['type'],
  confidence: EmailEvidenceEvent['confidence'],
  occurredAt: string,
): EmailEvidenceEvent {
  return { type, confidence, occurredAt, automated: type.endsWith('_automated') };
}
