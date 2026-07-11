import {
  humanizeWorkflowPort,
  humanizeWorkflowStepMessage,
  stepTone,
} from '../../shared/workflow-run-humanize';

// Alle explizit gemappten Schritt-Codes (siehe Executoren in
// electron/workflow/nodes/*.ts und electron/workflow/runtime.ts).
const EXACT_CODES = [
  'auto_reply:blocked:disabled',
  'auto_reply:blocked:noreply_sender',
  'auto_reply:blocked:automated_sender',
  'auto_reply:blocked:rate_limited',
  'auto_reply:blocked:low_confidence',
  'auto_reply:blocked:no_message',
  'auto_reply:approved',
  'send_draft_queued_auto',
  'send_draft_queued_with_review',
  'auto_reply_disabled',
  'noreply_sender_blocked',
  'automated_sender_blocked',
  'auto_reply_rate_limited',
  'forward_copy:attachments_skipped_desktop',
  'outbound_hold_cleared',
  'outbound_hold_released',
  'outbound_hold_released_auto_send',
  'leerer Tag',
  'skip:no_prior_condition',
  'graph_run_start',
  'graph_missing',
  'no_trigger',
  'trigger_no_edges',
  'stop',
  'loop:empty',
];

describe('humanizeWorkflowStepMessage', () => {
  it.each(EXACT_CODES)('übersetzt %s in einen deutschen Satz', (code) => {
    const result = humanizeWorkflowStepMessage(code);
    expect(result).not.toBeNull();
    expect(result).not.toBe(code);
    // Ganze Sätze, keine Maschinen-Codes.
    expect(result).toMatch(/[a-zäöüß] /i);
  });

  it('erklärt den Automatisierungs-Schalter bei auto_reply:blocked:disabled', () => {
    expect(humanizeWorkflowStepMessage('auto_reply:blocked:disabled')).toContain(
      'Einstellungen → Automatisierung',
    );
  });

  it('erklärt das Tageslimit bei rate_limited', () => {
    expect(humanizeWorkflowStepMessage('auto_reply:blocked:rate_limited')).toContain('Tageslimit');
  });

  it('fällt bei unbekannten auto_reply-Gründen auf den Präfix zurück', () => {
    const result = humanizeWorkflowStepMessage('auto_reply:blocked:neuer_grund');
    expect(result).toContain('Auto-Antwort übersprungen');
    expect(result).toContain('neuer_grund');
  });

  it('hängt bei imap_seen_sync_deferred: das Detail an', () => {
    const result = humanizeWorkflowStepMessage('imap_seen_sync_deferred: Timeout beim IMAP-Server');
    expect(result).toContain('nachgeholt');
    expect(result).toContain('Timeout beim IMAP-Server');
  });

  it('hängt bei review_error: das Detail an', () => {
    const result = humanizeWorkflowStepMessage('review_error:Provider nicht erreichbar');
    expect(result).toContain('manuelle Freigabe');
    expect(result).toContain('Provider nicht erreichbar');
  });

  it('übersetzt delayed_until: mit Zeitangabe', () => {
    const result = humanizeWorkflowStepMessage('delayed_until:2026-07-10T12:00:00.000Z');
    expect(result).toContain('pausiert');
    expect(result).not.toContain('delayed_until');
  });

  it('markiert dry-run-Meldungen als Testlauf', () => {
    for (const code of ['dry-run draft', 'dry-run spam_score', 'dry-run subflow 5']) {
      expect(humanizeWorkflowStepMessage(code)).toContain('Testlauf');
    }
  });

  it('übersetzt Runtime-Log-Marker per Präfix', () => {
    expect(humanizeWorkflowStepMessage('condition:subject:yes')).toContain('erfüllt');
    expect(humanizeWorkflowStepMessage('condition:subject:yes')).toContain('subject');
    expect(humanizeWorkflowStepMessage('condition:subject:no')).toContain('nicht erfüllt');
    expect(humanizeWorkflowStepMessage('branch:node-1')).toContain('node-1');
    expect(humanizeWorkflowStepMessage('graph_resume:node-5')).toContain('node-5');
    expect(humanizeWorkflowStepMessage('cycle:node-9')).toContain('node-9');
    expect(humanizeWorkflowStepMessage('unknown_node:foo.bar')).toContain('foo.bar');
    expect(humanizeWorkflowStepMessage('loop:limit:50')).toContain('50');
    expect(humanizeWorkflowStepMessage('loop:2:rechnung.pdf')).toBe(
      'Schleifendurchlauf 3: rechnung.pdf',
    );
  });

  it('behandelt skip:<nodeId>:no_prior_condition wie den exakten Code', () => {
    expect(humanizeWorkflowStepMessage('skip:node-1:no_prior_condition')).toBe(
      humanizeWorkflowStepMessage('skip:no_prior_condition'),
    );
  });

  it('reicht unbekannte und bereits deutsche Meldungen unverändert durch', () => {
    expect(humanizeWorkflowStepMessage('Kein Kunde verknüpft')).toBe('Kein Kunde verknüpft');
    expect(humanizeWorkflowStepMessage('Entwurf 5 nicht gefunden')).toBe('Entwurf 5 nicht gefunden');
    expect(humanizeWorkflowStepMessage('some_unknown_code')).toBe('some_unknown_code');
    expect(humanizeWorkflowStepMessage('skip:anderer_grund')).toBe('skip:anderer_grund');
  });

  it('liefert null für leere Eingaben', () => {
    expect(humanizeWorkflowStepMessage(null)).toBeNull();
    expect(humanizeWorkflowStepMessage(undefined)).toBeNull();
    expect(humanizeWorkflowStepMessage('')).toBeNull();
    expect(humanizeWorkflowStepMessage('   ')).toBeNull();
  });
});

describe('humanizeWorkflowPort', () => {
  const MAPPED: [string, string][] = [
    ['approved', 'Erlaubt'],
    ['blocked', 'Blockiert'],
    ['send', 'Senden'],
    ['hold', 'Prüfen (wartet auf Freigabe)'],
    ['yes', 'Ja'],
    ['no', 'Nein'],
    ['each', 'Je Element'],
    ['done', 'Fertig'],
    ['pass', 'Bestanden'],
    ['fail', 'Nicht bestanden'],
    ['none', 'Keine Daten'],
    ['whitelist', 'Vertrauenswürdig'],
    ['blacklist', 'Blockiert'],
    ['default', 'Standard'],
    ['error', 'Fehler'],
  ];

  it.each(MAPPED)('übersetzt %s → %s', (port, label) => {
    expect(humanizeWorkflowPort(port)).toBe(label);
  });

  it('reicht unbekannte Ports (z. B. Switch-Fälle) unverändert durch', () => {
    expect(humanizeWorkflowPort('refund')).toBe('refund');
    expect(humanizeWorkflowPort('A')).toBe('A');
  });

  it('liefert null für leere Eingaben', () => {
    expect(humanizeWorkflowPort(null)).toBeNull();
    expect(humanizeWorkflowPort(undefined)).toBeNull();
    expect(humanizeWorkflowPort('')).toBeNull();
    expect(humanizeWorkflowPort('  ')).toBeNull();
  });
});

describe('stepTone', () => {
  it('error-Status hat Vorrang', () => {
    expect(stepTone('error', null)).toBe('error');
    expect(stepTone('error', 'approved')).toBe('error');
    expect(stepTone('error', 'blocked')).toBe('error');
  });

  it('blocked/hold-Ports und skipped/blocked-Status ergeben warn', () => {
    expect(stepTone('ok', 'blocked')).toBe('warn');
    expect(stepTone('ok', 'hold')).toBe('warn');
    expect(stepTone('skipped', null)).toBe('warn');
    expect(stepTone('blocked', null)).toBe('warn');
  });

  it('alles andere ergibt ok', () => {
    expect(stepTone('ok', null)).toBe('ok');
    expect(stepTone('ok', 'approved')).toBe('ok');
    expect(stepTone('ok', 'send')).toBe('ok');
    expect(stepTone('running', null)).toBe('ok');
    expect(stepTone(null, null)).toBe('ok');
    expect(stepTone(undefined, undefined)).toBe('ok');
  });
});
