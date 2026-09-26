import {
  buildLearningsDigestPrompt,
  cleanLearningSubject,
  computeLearningsDigestProposal,
  computeLearningTextChangeRatio,
  isLearningsCollectEnabledValue,
  learningsPeriodStart,
  learningsRetentionCutoff,
  normalizeLearningsDigestPeriod,
  normalizeLearningsMinCandidates,
  parseLearningsDigestResponse,
  selectLearningCandidatesForDigest,
  truncateLearningText,
  type LearningCandidateForDigest,
} from '../../packages/core/src/learnings/digest';
import {
  learningNamesFromAddressJson,
  prepareNoteLearningCandidate,
  prepareSentLearningCandidate,
} from '../../packages/core/src/learnings/candidates';
import { computeTextChangeRatio } from '../../packages/server/src/ai-feedback';

function candidate(id: number, overrides: Partial<LearningCandidateForDigest> = {}): LearningCandidateForDigest {
  return {
    id,
    kind: 'human_reply',
    questionText: 'Betreff: Rückgabe\n\nKann ich zurückgeben?',
    aiText: null,
    humanText: 'Ja, innerhalb von 30 Tagen.',
    noteText: null,
    createdAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('parseLearningsDigestResponse (TA-P5)', () => {
  it('liest JSON in Codeblöcken mit Zusatztext', () => {
    const raw = 'Hier ist mein Vorschlag:\n```json\n{"summary":"Rückgabefrist korrigiert.","operations":[{"op":"update","section":"## Rückgabe","content":"30 Tage.","reason":"Mitarbeiter nennen 30 Tage"}]}\n```\nViel Erfolg!';
    const parsed = parseLearningsDigestResponse(raw);
    expect(parsed).toEqual({
      ok: true,
      discarded: 0,
      value: {
        summary: 'Rückgabefrist korrigiert.',
        operations: [{ op: 'update', section: 'Rückgabe', content: '30 Tage.', reason: 'Mitarbeiter nennen 30 Tage' }],
      },
    });
  });

  it('toleriert Text mit Klammern vor dem JSON, Synonyme und verwirft Unbrauchbares', () => {
    const raw = 'Notiz {nicht json} und dann: {"summary":"x","operations":[{"action":"remove","title":"Alt"},{"op":"create","heading":"Neu","text":"Inhalt"},{"op":"update","section":"","content":"x"},{"op":"add","section":"Leer","content":"  "},{"op":"frobnicate","section":"A","content":"b"},"kaputt"]}';
    const parsed = parseLearningsDigestResponse(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.operations).toEqual([
      { op: 'delete', section: 'Alt' },
      { op: 'add', section: 'Neu', content: 'Inhalt' },
    ]);
    expect(parsed.discarded).toBe(4);
  });

  it('begrenzt Anzahl und Länge', () => {
    const ops = Array.from({ length: 50 }, (_, i) => ({ op: 'add', section: `T${i}`, content: 'x'.repeat(10) }));
    const parsed = parseLearningsDigestResponse(JSON.stringify({ summary: 's'.repeat(5000), operations: ops }), {
      maxOperations: 5,
      maxContentLength: 4,
      maxSummaryLength: 10,
    });
    expect(parsed.ok && parsed.value.operations.length).toBe(5);
    expect(parsed.ok && parsed.value.operations[0]!.content).toBe('xxxx');
    expect(parsed.ok && parsed.value.summary).toBe('ssssssssss');
    expect(parsed.ok && parsed.discarded).toBe(45);
  });

  // Viele offene Klammern ohne Gegenstück: die Kandidatensuche war quadratisch.
  it('bleibt bei entarteter Antwort schnell', () => {
    const started = Date.now();
    expect(parseLearningsDigestResponse('{'.repeat(200_000)).ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('meldet Fehler bei leerer/kaputter Antwort', () => {
    expect(parseLearningsDigestResponse('')).toEqual({ ok: false, error: 'Leere Antwort der KI' });
    expect(parseLearningsDigestResponse('Ich kann das nicht.')).toEqual({ ok: false, error: 'Antwort der KI enthält kein gültiges JSON' });
    expect(parseLearningsDigestResponse('{"summary":"x","operations":"nein"}').ok).toBe(false);
    expect(parseLearningsDigestResponse('[{"op":"add","section":"A","content":"b"}]')).toEqual({
      ok: true,
      discarded: 0,
      value: { summary: '', operations: [{ op: 'add', section: 'A', content: 'b' }] },
    });
  });
});

describe('Prompt und Auswahl (TA-P5)', () => {
  it('baut den Prompt mit Wissensbasis und Beobachtungen', () => {
    const prompt = buildLearningsDigestPrompt({
      knowledgeBaseName: 'Learnings',
      currentDocument: '## Rückgabe\n\n14 Tage.',
      candidates: [
        candidate(1, { kind: 'draft_edit', aiText: '14 Tage.', humanText: '30 Tage.' }),
        candidate(2, { kind: 'note', questionText: null, humanText: null, noteText: 'Wir duzen Stammkunden nicht.' }),
      ],
    });
    expect(prompt.system).toContain('keine personenbezogenen Daten');
    expect(prompt.system).toContain('"operations"');
    expect(prompt.user).toContain('## Rückgabe\n\n14 Tage.');
    expect(prompt.user).toContain('### Beobachtung 1 (KI-Entwurf, vom Menschen geändert)');
    expect(prompt.user).toContain('KI-Entwurf:\n14 Tage.');
    expect(prompt.user).toContain('Gesendete Fassung:\n30 Tage.');
    expect(prompt.user).toContain('Notiz:\nWir duzen Stammkunden nicht.');
    expect(prompt.user).not.toContain('Anfrage:\n\n');
  });

  it('wählt höchstens N Kandidaten und begrenzt die Gesamtlänge', () => {
    const list = Array.from({ length: 10 }, (_, i) => candidate(i, { humanText: 'x'.repeat(100) }));
    expect(selectLearningCandidatesForDigest(list, { maxCount: 3 }).map((c) => c.id)).toEqual([0, 1, 2]);
    const withBig = [candidate(1), candidate(2, { humanText: 'y'.repeat(1000) }), candidate(3)];
    expect(selectLearningCandidatesForDigest(withBig, { maxTotalChars: 200 }).map((c) => c.id)).toEqual([1, 3]);
  });

  it('Zeitraum, Aufbewahrung und Normalisierung', () => {
    const now = new Date('2026-09-26T12:00:00.000Z');
    const last = new Date('2026-09-20T00:00:00.000Z');
    expect(learningsPeriodStart('since_last', now, last)).toBe(last);
    expect(learningsPeriodStart('since_last', now, null)).toBeNull();
    expect(learningsPeriodStart('day', now)?.toISOString()).toBe('2026-09-25T12:00:00.000Z');
    expect(learningsPeriodStart('week', now)?.toISOString()).toBe('2026-09-19T12:00:00.000Z');
    expect(learningsPeriodStart('month', now)?.toISOString()).toBe('2026-08-27T12:00:00.000Z');
    expect(learningsRetentionCutoff(now).toISOString()).toBe('2026-06-28T12:00:00.000Z');
    expect(normalizeLearningsDigestPeriod('quarter')).toBe('since_last');
    expect(normalizeLearningsMinCandidates('0')).toBe(3);
    expect(normalizeLearningsMinCandidates('7')).toBe(7);
    expect(normalizeLearningsMinCandidates(5000)).toBe(200);
    expect(isLearningsCollectEnabledValue('1')).toBe(true);
    expect(isLearningsCollectEnabledValue('true')).toBe(true);
    expect(isLearningsCollectEnabledValue('0')).toBe(false);
    expect(isLearningsCollectEnabledValue(null)).toBe(false);
    expect(cleanLearningSubject('AW: Re: [SCR-12AB] Rückgabe Jacke')).toBe('Rückgabe Jacke');
    expect(truncateLearningText('abcdef', 4)).toBe('abc…');
  });

  it('Änderungsquote entspricht computeTextChangeRatio des Servers', () => {
    const pairs: Array<[string, string]> = [
      ['Hallo Welt', 'Hallo Welt'],
      ['Versand in 2 Tagen', 'Versand in 3 Werktagen'],
      ['', 'x'],
      ['', ''],
    ];
    for (const [a, b] of pairs) {
      expect(computeLearningTextChangeRatio(a, b)).toBe(computeTextChangeRatio(a, b));
    }
  });
});

describe('Kandidaten aufbereiten (TA-P5)', () => {
  const parent = {
    parentSubject: 'Re: [SCR-77] Rückgabe',
    parentText: 'Hallo,\n\nich bin Max Mustermann (Kd.-Nr. 12345), Tel. 0761 123456. Kann ich die Jacke zurückgeben?\n\nGruß\nMax',
  };

  it('draft_edit: nur bei deutlicher Änderung, bereinigt', () => {
    const snapshot = 'Die Rückgabe ist innerhalb von 14 Tagen möglich.';
    const unchanged = prepareSentLearningCandidate({
      ...parent,
      aiSnapshot: snapshot,
      sentText: `Hallo Herr Mustermann,\n\n${snapshot}\n\nViele Grüße\nErika`,
      names: ['Max Mustermann'],
    });
    expect(unchanged).toBeNull();

    const edited = prepareSentLearningCandidate({
      ...parent,
      aiSnapshot: snapshot,
      sentText: 'Hallo Herr Mustermann,\n\nDie Rückgabe ist innerhalb von 30 Tagen kostenlos möglich, Etikett im Kundenkonto.\n\nViele Grüße\nErika\n\nAm 1.1.2026 schrieb Max Mustermann <max@example.com>:\n> alt',
      names: ['Max Mustermann', 'Erika Beispiel'],
    });
    expect(edited).toMatchObject({
      kind: 'draft_edit',
      aiText: snapshot,
      humanText: 'Die Rückgabe ist innerhalb von 30 Tagen kostenlos möglich, Etikett im Kundenkonto.',
      noteText: null,
    });
    expect(edited!.changeRatio).toBeGreaterThan(0.05);
    expect(edited!.questionText).toBe('Betreff: Rückgabe\n\nich bin [Name] (Kd.-Nr. [Nummer]), Tel. [Telefon]. Kann ich die Jacke zurückgeben?');
  });

  it('human_reply braucht Frage und Antwort; verschlüsselte Mails werden ignoriert', () => {
    expect(prepareSentLearningCandidate({ ...parent, sentText: 'Ja, gerne.' })).toMatchObject({
      kind: 'human_reply',
      humanText: 'Ja, gerne.',
      aiText: null,
    });
    expect(prepareSentLearningCandidate({ sentText: 'Ja, gerne.' })).toBeNull();
    expect(prepareSentLearningCandidate({ ...parent, sentText: '' })).toBeNull();
    expect(prepareSentLearningCandidate({ ...parent, sentText: '-----BEGIN PGP MESSAGE-----\nabc' })).toBeNull();
  });

  it('begrenzt Textlängen auf 4000 Zeichen', () => {
    const long = prepareSentLearningCandidate({ ...parent, sentText: 'Wort '.repeat(2000) });
    expect(long!.humanText!.length).toBeLessThanOrEqual(4000);
  });

  it('Notiz mit und ohne Mail-Bezug', () => {
    expect(prepareNoteLearningCandidate({ note: '  ' })).toBeNull();
    expect(prepareNoteLearningCandidate({ note: 'Rückrufe an max@example.com nur vormittags.' })).toEqual({
      kind: 'note',
      questionText: null,
      aiText: null,
      humanText: null,
      noteText: 'Rückrufe an [E-Mail] nur vormittags.',
    });
    const withMail = prepareNoteLearningCandidate({
      note: 'Bei Frau Mustermann immer Sie-Form.',
      questionSubject: 'Frage',
      questionText: 'Hallo, wie lange dauert der Versand?',
      names: ['Erika Mustermann'],
    });
    expect(withMail).toMatchObject({ noteText: 'Bei Frau [Name] immer Sie-Form.', questionText: 'Betreff: Frage\n\nHallo, wie lange dauert der Versand?' });
  });

  it('liest Namen aus Adress-JSON', () => {
    expect(learningNamesFromAddressJson('{"value":[{"name":"Max Mustermann","address":"max@example.com"}]}'))
      .toEqual(['Max Mustermann', 'max@example.com']);
    expect(learningNamesFromAddressJson([{ address: 'a@b.de' }])).toEqual(['a@b.de']);
    expect(learningNamesFromAddressJson('kaputt')).toEqual([]);
    expect(learningNamesFromAddressJson(null)).toEqual([]);
  });
});

describe('computeLearningsDigestProposal (TA-P5)', () => {
  const base = '# Learnings\n\n## Kontakt\n\nHotline 0800 1234567.\n\n## Rückgabe\n\n14 Tage.\n';

  it('wendet bereinigte Operationen an und behält vorhandene Kontaktdaten', async () => {
    const chat = jest.fn(async () => JSON.stringify({
      summary: 'Frist korrigiert, Kunde max@example.com erwähnt.',
      operations: [
        { op: 'update', section: 'Rückgabe', content: '30 Tage, Etikett im Kundenkonto. Rückfragen an 0761 123456.' },
        { op: 'update', section: 'Kontakt', content: 'Hotline 0800 1234567, Mo–Fr.' },
      ],
    }));
    const result = await computeLearningsDigestProposal({
      knowledgeBaseName: 'Learnings',
      baseContent: base,
      candidates: [candidate(1)],
      chat,
    });
    expect(chat).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toBe('Frist korrigiert, Kunde [E-Mail] erwähnt.');
    expect(result.proposedContent).toBe(
      '# Learnings\n\n## Kontakt\n\nHotline 0800 1234567, Mo–Fr.\n\n## Rückgabe\n\n30 Tage, Etikett im Kundenkonto. Rückfragen an [Telefon].\n',
    );
    expect(result.applied.map((a) => a.result)).toEqual(['updated', 'updated']);
  });

  it('meldet KI- und Parse-Fehler sowie zu lange Ergebnisse', async () => {
    const failing = await computeLearningsDigestProposal({
      knowledgeBaseName: 'L',
      baseContent: base,
      candidates: [candidate(1)],
      chat: async () => { throw new Error('Zeitüberschreitung'); },
    });
    expect(failing).toEqual({ ok: false, error: 'KI-Aufruf fehlgeschlagen: Zeitüberschreitung' });
    const garbage = await computeLearningsDigestProposal({
      knowledgeBaseName: 'L',
      baseContent: base,
      candidates: [candidate(1)],
      chat: async () => 'kein JSON',
    });
    expect(garbage).toEqual({ ok: false, error: 'Antwort der KI enthält kein gültiges JSON' });
    const tooLong = await computeLearningsDigestProposal({
      knowledgeBaseName: 'L',
      baseContent: base,
      candidates: [candidate(1)],
      chat: async () => JSON.stringify({ operations: [{ op: 'add', section: 'Groß', content: 'x'.repeat(500) }] }),
      maxDocumentLength: 200,
    });
    expect(tooLong.ok).toBe(false);
  });
});
