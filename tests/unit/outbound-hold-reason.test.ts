import {
  OUTBOUND_HOLD_FALLBACK_REASON,
  OUTBOUND_WARNING_MARKER,
  composeOutboundHeldDraftBody,
  extractDraftBodyForOutboundBlock,
  outboundHoldReasonOrFallback,
} from '../../packages/core/src/email';

describe('Ausgang: Grund einer Sperre (TA-P2)', () => {
  test('leerer oder fehlender Grund ergibt den einheitlichen Fallback-Text', () => {
    expect(OUTBOUND_HOLD_FALLBACK_REASON).toBe(
      'Vom Workflow ohne Begründung angehalten – bitte E-Mail prüfen.',
    );
    expect(outboundHoldReasonOrFallback('')).toBe(OUTBOUND_HOLD_FALLBACK_REASON);
    expect(outboundHoldReasonOrFallback('   ')).toBe(OUTBOUND_HOLD_FALLBACK_REASON);
    expect(outboundHoldReasonOrFallback(null)).toBe(OUTBOUND_HOLD_FALLBACK_REASON);
    expect(outboundHoldReasonOrFallback(undefined)).toBe(OUTBOUND_HOLD_FALLBACK_REASON);
  });

  test('ein echter Grund bleibt erhalten (getrimmt, auf 500 Zeichen begrenzt)', () => {
    expect(outboundHoldReasonOrFallback('  Preisangabe fehlt ')).toBe('Preisangabe fehlt');
    expect(outboundHoldReasonOrFallback('x'.repeat(600))).toHaveLength(500);
  });

  test('Banner-Body ersetzt einen vorhandenen Banner durch den neuen Grund', () => {
    const first = composeOutboundHeldDraftBody(
      extractDraftBodyForOutboundBlock({ body_text: 'Hallo Kunde', body_html: '<p>Hallo Kunde</p>' }),
      'Prüfung läuft',
    );
    expect(first.bodyText.startsWith(OUTBOUND_WARNING_MARKER)).toBe(true);
    expect(first.bodyText).toContain('Prüfung läuft');

    const second = composeOutboundHeldDraftBody(
      extractDraftBodyForOutboundBlock({ body_text: first.bodyText, body_html: first.bodyHtml }),
      'Preisangabe fehlt',
    );
    expect(second.bodyText).toContain('Preisangabe fehlt');
    expect(second.bodyText).not.toContain('Prüfung läuft');
    expect(second.bodyHtml).toContain('Preisangabe fehlt');
    expect(second.bodyHtml).not.toContain('Prüfung läuft');
    expect(second.bodyText.split(OUTBOUND_WARNING_MARKER)).toHaveLength(2);
    expect(second.bodyText).toContain('Hallo Kunde');
    expect(second.plain).toBe('Hallo Kunde');
  });

  test('ohne Inhalt entsteht nur der Banner; HTML wird maskiert', () => {
    const empty = composeOutboundHeldDraftBody({ plain: '', html: '' }, 'Grund <b>');
    expect(empty.bodyHtml).toContain('Grund &lt;b&gt;');
    expect(empty.plain).toBe('');
  });
});
