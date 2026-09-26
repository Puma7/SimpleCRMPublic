import {
  COMPOSE_BODY_MARKER,
  COMPOSE_QUOTE_MARKER,
  COMPOSE_SIGNATURE_MARKER,
} from '../../shared/compose-body';
import {
  SENT_AI_VIEW_KINDS,
  composeOutboundHeldDraftBody,
  determineSentProvenance,
  draftContentChanged,
  sentByBadgeLabel,
  sentByDescription,
  workflowSentByLabel,
} from '../../packages/core/src/email';

describe('Kennzeichnung „gesendet von“ (TA-P3)', () => {
  const base = { draftOriginWorkflowId: 7, draftOriginEdited: false, outboundReviewSkipped: false };

  test('Workflow-Versand ohne Mensch: KI-Entwurf ⇒ ai_auto, sonst workflow', () => {
    expect(determineSentProvenance({
      ...base,
      actor: { kind: 'workflow', workflowId: null, workflowName: 'KI-Antwort' },
      draftOriginKind: 'ai',
    })).toEqual({ kind: 'ai_auto', userId: null, workflowId: 7, label: 'Workflow „KI-Antwort“', outboundReviewSkipped: false });
    expect(determineSentProvenance({
      ...base,
      actor: { kind: 'workflow', workflowId: 9, workflowName: null },
      draftOriginKind: 'workflow',
    })).toMatchObject({ kind: 'workflow', workflowId: 9, label: null });
    expect(determineSentProvenance({
      ...base,
      actor: { kind: 'workflow', workflowId: null, workflowName: null },
      draftOriginKind: null,
    }).kind).toBe('workflow');
  });

  test('Mensch sendet: unveränderter KI-Entwurf ⇒ ai_approved, geändert oder eigener ⇒ human', () => {
    const human = { kind: 'human' as const, userId: 'u1', userLabel: 'Anna Beispiel' };
    expect(determineSentProvenance({ ...base, actor: human, draftOriginKind: 'ai' }))
      .toEqual({ kind: 'ai_approved', userId: 'u1', workflowId: 7, label: 'Anna Beispiel', outboundReviewSkipped: false });
    expect(determineSentProvenance({ ...base, actor: human, draftOriginKind: 'ai', draftOriginEdited: true }))
      .toMatchObject({ kind: 'human', userId: 'u1', workflowId: null });
    expect(determineSentProvenance({ ...base, actor: human, draftOriginKind: null }).kind).toBe('human');
    expect(determineSentProvenance({ ...base, actor: human, draftOriginKind: 'workflow' }).kind).toBe('human');
    expect(determineSentProvenance({ ...base, actor: human, draftOriginKind: null, outboundReviewSkipped: true })
      .outboundReviewSkipped).toBe(true);
  });

  test('Relay behält den Client-Namen', () => {
    expect(determineSentProvenance({
      ...base,
      actor: { kind: 'relay', clientLabel: ' Shop ' },
      draftOriginKind: null,
    })).toEqual({ kind: 'relay', userId: null, workflowId: null, label: 'Shop', outboundReviewSkipped: false });
  });

  test('Kennzeichen und Texte der Oberfläche', () => {
    expect(sentByBadgeLabel('ai_auto')).toBe('KI');
    expect(sentByBadgeLabel('ai_approved')).toBe('KI · freigegeben');
    expect(sentByBadgeLabel('workflow')).toBe('Automatik');
    expect(sentByBadgeLabel('relay')).toBe('Relay');
    expect(sentByBadgeLabel('human')).toBeNull();
    expect(sentByBadgeLabel(null)).toBeNull();
    expect(workflowSentByLabel('Auto')).toBe('Workflow „Auto“');
    expect(sentByDescription({ kind: 'human', label: 'Anna' })).toBe('Gesendet von: Anna');
    expect(sentByDescription({ kind: 'ai_auto', label: 'Workflow „Auto“' }))
      .toBe('Automatisch von KI gesendet (Workflow „Auto“)');
    expect(sentByDescription({ kind: 'ai_approved', label: 'Anna' })).toBe('KI-Entwurf, freigegeben von Anna');
    expect(sentByDescription({ kind: null, label: null })).toBeNull();
    expect([...SENT_AI_VIEW_KINDS]).toEqual(['ai_auto', 'ai_approved', 'workflow']);
  });
});

describe('draftContentChanged: echte Änderung eines KI-Entwurfs (TA-P3)', () => {
  const aiDraft = {
    subject: 'Re: Frage zur Lieferung',
    bodyText: 'Guten Tag,\n\nIhre Bestellung kommt morgen.\n\nViele Grüße',
    bodyHtml: null,
    to: JSON.stringify({ value: [{ address: 'Kunde@Example.com', name: 'Kunde' }] }),
    cc: null,
    bcc: null,
    attachmentPaths: [],
    accountId: 3,
  };

  test('Speichern im Entwurfsfenster ohne Änderung ist keine Änderung', () => {
    expect(draftContentChanged(aiDraft, {
      ...aiDraft,
      // Editor: Absätze als HTML, Text neu aus dem HTML gewonnen, Empfänger als Objekt.
      bodyText: 'Guten Tag, Ihre Bestellung kommt morgen. Viele Grüße',
      bodyHtml: '<p>Guten Tag,</p><p>Ihre Bestellung kommt morgen.</p><p>Viele Grüße</p>',
      to: { value: [{ address: 'kunde@example.com', name: 'Kunde GmbH' }] },
      cc: '',
    })).toBe(false);
  });

  test('der Hinweis „Versand blockiert“ zählt nicht als Inhalt', () => {
    const held = composeOutboundHeldDraftBody(
      { plain: aiDraft.bodyText, html: '' },
      'Preisangabe fehlt',
    );
    expect(draftContentChanged(aiDraft, { ...aiDraft, bodyText: held.bodyText, bodyHtml: held.bodyHtml })).toBe(false);
  });

  test.each([
    ['Text', { bodyText: 'Guten Tag, Ihre Bestellung kommt übermorgen. Viele Grüße' }],
    ['Betreff', { subject: 'Re: Frage zur Lieferung (dringend)' }],
    ['Empfänger', { to: 'andere@example.com' }],
    ['Kopie', { cc: 'chef@example.com' }],
    ['Anhang', { attachmentPaths: ['/tmp/rechnung.pdf'] }],
    ['Konto', { accountId: 4 }],
  ])('%s geändert ⇒ Änderung', (_label, patch) => {
    expect(draftContentChanged(aiDraft, { ...aiDraft, ...patch })).toBe(true);
  });

  describe('Review B7: Text- und HTML-Fassung zählen beide', () => {
    const withHtml = {
      ...aiDraft,
      bodyText: 'Guten Tag, Ihre Bestellung kommt morgen. Viele Grüße',
      bodyHtml: '<p>Guten Tag,</p><p>Ihre Bestellung kommt <a href="https://shop.example.test/status">morgen</a>.</p><p>Viele Grüße</p>',
    };

    test('nur das HTML geändert (Text im HTML oder ein Link-Ziel) ⇒ Änderung', () => {
      expect(draftContentChanged(withHtml, {
        ...withHtml,
        bodyHtml: withHtml.bodyHtml.replace('morgen</a>', 'übermorgen</a>'),
      })).toBe(true);
      expect(draftContentChanged(withHtml, {
        ...withHtml,
        bodyHtml: withHtml.bodyHtml.replace('shop.example.test', 'phish.example.test'),
      })).toBe(true);
      // Ein Link um vorhandenen Text im bisher reinen Text-Entwurf.
      expect(draftContentChanged(aiDraft, {
        ...aiDraft,
        bodyText: 'Guten Tag, Ihre Bestellung kommt morgen. Viele Grüße',
        bodyHtml: '<p>Guten Tag,</p><p>Ihre Bestellung kommt <a href="https://phish.example.test/">morgen</a>.</p><p>Viele Grüße</p>',
      })).toBe(true);
    });

    test('nur der Textteil geändert ⇒ Änderung; unverändert gespeichert ⇒ keine', () => {
      expect(draftContentChanged(withHtml, { ...withHtml, bodyText: 'Guten Tag, Ihre Bestellung kommt übermorgen. Viele Grüße' })).toBe(true);
      expect(draftContentChanged(withHtml, {
        ...withHtml,
        bodyText: 'Guten Tag,\n\nIhre Bestellung kommt morgen.\n\nViele Grüße',
        bodyHtml: withHtml.bodyHtml.replace('<a href', '<a target="_blank" href'),
      })).toBe(false);
    });
  });

  describe('Zonen des Entwurfsfensters', () => {
    const signature = '<p>Erika Beispiel<br/>Support</p>';
    const quote = '<p>Am 25.09. schrieb Kunde: Wann kommt meine Bestellung?</p>';
    // Wie das Entwurfsfenster speichert: Text aus dem ganzen Editor (inkl. Signatur).
    function saved(bodyHtml: string, extras: { signature?: string; quote?: string } = {}) {
      const html = `${bodyHtml}${extras.signature ? `${COMPOSE_SIGNATURE_MARKER}${extras.signature}` : ''}`
        + `${extras.quote ? `${COMPOSE_QUOTE_MARKER}${extras.quote}` : ''}`;
      return {
        ...aiDraft,
        bodyHtml: html,
        bodyText: html.replace(/<!--[^>]*-->/g, ' ').replace(/<[^>]+>/g, ' '),
      };
    }
    const aiBodyHtml = '<p>Guten Tag,</p><p>Ihre Bestellung kommt morgen.</p><p>Viele Grüße</p>';

    test('automatisch eingesetzte Signatur oder Zitat ist keine Änderung', () => {
      expect(draftContentChanged(aiDraft, saved(aiBodyHtml, { signature }))).toBe(false);
      expect(draftContentChanged(aiDraft, saved(aiBodyHtml, { signature, quote }))).toBe(false);
      // Anrede-Zone vor dem Text: ebenfalls unverändert.
      expect(draftContentChanged(
        aiDraft,
        saved(`<p>Guten Tag,</p>${COMPOSE_BODY_MARKER}<p>Ihre Bestellung kommt morgen.</p><p>Viele Grüße</p>`, { signature }),
      )).toBe(false);
    });

    test('geänderter Text bleibt eine Änderung, auch mit Signatur-Zone', () => {
      expect(draftContentChanged(
        aiDraft,
        saved('<p>Guten Tag,</p><p>Ihre Bestellung kommt übermorgen.</p><p>Viele Grüße</p>', { signature }),
      )).toBe(true);
      // Eine geänderte Anrede zählt (Zone vor dem Text gehört zum Geschriebenen).
      expect(draftContentChanged(
        aiDraft,
        saved(`<p>Sehr geehrte Frau Muster,</p>${COMPOSE_BODY_MARKER}<p>Ihre Bestellung kommt morgen.</p><p>Viele Grüße</p>`, { signature }),
      )).toBe(true);
    });

    test('Grenze: nur die Signatur zu ändern gilt nicht als Bearbeitung des KI-Texts', () => {
      expect(draftContentChanged(
        saved(aiBodyHtml, { signature }),
        saved(aiBodyHtml, { signature: '<p>Erika Beispiel<br/>Teamleitung Support</p>' }),
      )).toBe(false);
    });
  });
});
