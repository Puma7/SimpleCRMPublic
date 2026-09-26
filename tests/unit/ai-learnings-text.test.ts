import {
  COMPOSE_BODY_MARKER,
  COMPOSE_QUOTE_MARKER,
  COMPOSE_SIGNATURE_MARKER,
} from '../../shared/compose-body';
import {
  extractLearningReplyText,
  LEARNING_COMPOSE_BODY_MARKER,
  LEARNING_COMPOSE_QUOTE_MARKER,
  LEARNING_COMPOSE_SIGNATURE_MARKER,
  learningHtmlToText,
  stripReplyNoise,
} from '../../packages/core/src/learnings/reply-noise';
import {
  applyKnowledgeOperations,
  normalizeKnowledgeSectionTitle,
  parseKnowledgeSections,
  serializeKnowledgeSections,
} from '../../packages/core/src/learnings/knowledge-sections';
import { diffText, summarizeTextDiff, type TextDiffSegment } from '../../packages/core/src/learnings/text-diff';

function rebuild(segments: TextDiffSegment[]): { before: string; after: string } {
  return {
    before: segments.filter((s) => s.type !== 'insert').map((s) => s.text).join(''),
    after: segments.filter((s) => s.type !== 'delete').map((s) => s.text).join(''),
  };
}

describe('stripReplyNoise (TA-P5)', () => {
  it('entfernt Anrede, Grußformel, Signatur und Zitat (deutsch)', () => {
    const mail = [
      'Hallo Herr Müller,',
      '',
      'die Rückgabe ist innerhalb von 30 Tagen kostenlos möglich.',
      'Das Etikett finden Sie im Kundenkonto.',
      '',
      'Mit freundlichen Grüßen',
      'Erika Beispiel',
      'Kundenservice',
      '',
      '-- ',
      'Beispiel GmbH · Musterweg 1',
      '',
      'Am 12.03.2024 um 10:15 schrieb Max Müller <max@example.com>:',
      '> Kann ich die Jacke zurückgeben?',
    ].join('\n');
    expect(stripReplyNoise(mail)).toBe('die Rückgabe ist innerhalb von 30 Tagen kostenlos möglich.\nDas Etikett finden Sie im Kundenkonto.');
  });

  it('erkennt Outlook- und englische Zitatköpfe sowie Mobil-Fußzeilen', () => {
    const outlook = 'Passt, danke.\n\nGesendet von meinem iPhone\n\n________________________________\nVon: Kunde <k@x.de>\nGesendet: Montag\nBetreff: Frage';
    expect(stripReplyNoise(outlook)).toBe('Passt, danke.');
    const english = 'Dear Anna,\n\nShipping takes 3-5 business days.\n\nBest regards\nTom\n\nOn Mon, 4 Mar 2024 at 10:00, Anna <a@b.com> wrote:\n> Hi';
    expect(stripReplyNoise(english)).toBe('Shipping takes 3-5 business days.');
    const original = 'Wir prüfen das.\n\n-----Ursprüngliche Nachricht-----\nVon: x';
    expect(stripReplyNoise(original)).toBe('Wir prüfen das.');
    const wrapped = 'Erledigt.\n\nAm Mo., 4. März 2024 um 10:00 Uhr schrieb Max Mustermann\n<max@example.com>:\n> alt';
    expect(stripReplyNoise(wrapped)).toBe('Erledigt.');
  });

  it('lässt Inhalt stehen, wenn „Hallo“ Teil eines Satzes ist oder Grüße mitten im Text stehen', () => {
    expect(stripReplyNoise('Hallo, die Rückgabe ist innerhalb von 14 Tagen möglich und kostenlos für Sie.'))
      .toBe('Hallo, die Rückgabe ist innerhalb von 14 Tagen möglich und kostenlos für Sie.');
    const text = 'Viele Grüße an das Team richten wir gern aus.\nZweite Zeile.\nDritte Zeile.\nVierte Zeile.\nFünfte Zeile.\nSechste Zeile.\nSiebte Zeile.';
    expect(stripReplyNoise(text)).toBe(text);
  });

  it('entfernt „> “-Zeilen im Text und leere Eingaben', () => {
    expect(stripReplyNoise('Ja.\n> Frage?\nNein.')).toBe('Ja.\nNein.');
    expect(stripReplyNoise('')).toBe('');
    expect(stripReplyNoise('   \n  ')).toBe('');
  });

  it('nutzt die Compose-Zonen-Marker (gleich wie shared/compose-body.ts)', () => {
    expect(LEARNING_COMPOSE_BODY_MARKER).toBe(COMPOSE_BODY_MARKER);
    expect(LEARNING_COMPOSE_QUOTE_MARKER).toBe(COMPOSE_QUOTE_MARKER);
    expect(LEARNING_COMPOSE_SIGNATURE_MARKER).toBe(COMPOSE_SIGNATURE_MARKER);
    const html = `<p>Hallo Herr Müller,</p>${COMPOSE_BODY_MARKER}<p>die Lieferung kommt am Freitag.</p><p>Viele Grüße</p>${COMPOSE_SIGNATURE_MARKER}<p>Erika</p>${COMPOSE_QUOTE_MARKER}<p>Wann kommt die Lieferung?</p>`;
    expect(extractLearningReplyText({ html, text: 'ignoriert' })).toBe('die Lieferung kommt am Freitag.');
    expect(extractLearningReplyText({ text: 'Hallo,\n\nOK.\n\nGruß' })).toBe('OK.');
    expect(extractLearningReplyText({ html: '<p>Nur HTML &amp; mehr</p><blockquote>Zitat</blockquote>' })).toBe('Nur HTML & mehr');
  });

  it('learningHtmlToText wandelt Absätze, Listen und Entities um', () => {
    expect(learningHtmlToText('<p>A&nbsp;B</p><ul><li>eins</li><li>zwei</li></ul><style>x{}</style>'))
      .toBe('A B\n- eins\n- zwei');
  });
});

describe('Wissensbasis-Abschnitte (TA-P5)', () => {
  const doc = '# Firma\n\nEinleitung.\n\n## Versand\n\nVersand in 2 Tagen.\n\n## Rückgabe\n\n30 Tage.\n\n```md\n## kein Abschnitt\n```\n';

  it('zerlegt verlustfrei und respektiert Codeblöcke', () => {
    const parsed = parseKnowledgeSections(doc);
    expect(parsed.preamble).toBe('# Firma\n\nEinleitung.\n\n');
    expect(parsed.sections.map((s) => s.title)).toEqual(['Versand', 'Rückgabe']);
    expect(parsed.sections[1]!.content).toBe('30 Tage.\n\n```md\n## kein Abschnitt\n```');
    expect(serializeKnowledgeSections(parsed)).toBe(doc);
    expect(serializeKnowledgeSections(parseKnowledgeSections('ohne Abschnitte'))).toBe('ohne Abschnitte');
    expect(serializeKnowledgeSections(parseKnowledgeSections('## A\n\nx'))).toBe('## A\n\nx');
  });

  it('normalisiert Titel tolerant', () => {
    expect(normalizeKnowledgeSectionTitle('##  Rückgabe  Fristen: ')).toBe('rückgabe fristen');
  });

  it('wendet add/update/delete stabil an', () => {
    const { content, applied } = applyKnowledgeOperations(doc, [
      { op: 'update', section: '  versand ', content: '## Versand\n\nVersand in 1-2 Werktagen.\n\n## Unterpunkt\nDetails' },
      { op: 'delete', section: 'RÜCKGABE' },
      { op: 'add', section: 'Zahlung', content: 'Rechnung und PayPal.' },
      { op: 'update', section: 'Öffnungszeiten', content: 'Mo–Fr 9–17 Uhr.' },
      { op: 'delete', section: 'gibt es nicht' },
      { op: 'add', section: '', content: 'x' },
      { op: 'update', section: 'Zahlung', content: '' },
    ]);
    expect(content).toBe(
      '# Firma\n\nEinleitung.\n\n## Versand\n\nVersand in 1-2 Werktagen.\n\n### Unterpunkt\nDetails\n\n## Zahlung\n\nRechnung und PayPal.\n\n## Öffnungszeiten\n\nMo–Fr 9–17 Uhr.\n',
    );
    expect(applied.map((a) => a.result)).toEqual(['updated', 'deleted', 'added', 'added', 'skipped', 'skipped', 'skipped']);
  });

  it('add auf vorhandenen Titel hängt an statt zu duplizieren', () => {
    const { content, applied } = applyKnowledgeOperations('## Versand\n\nA.\n', [
      { op: 'add', section: 'Versand', content: 'B.' },
      { op: 'add', section: 'versand', content: 'B.' },
    ]);
    expect(content).toBe('## Versand\n\nA.\n\nB.\n');
    expect(applied.map((a) => a.result)).toEqual(['appended', 'skipped']);
  });

  it('fügt in ein Dokument ohne Abschnitte ein und lässt unveränderte Abschnitte unberührt', () => {
    expect(applyKnowledgeOperations('# Learnings\n\nText.\n', [{ op: 'add', section: 'Ton', content: 'Sie-Form.' }]).content)
      .toBe('# Learnings\n\nText.\n\n## Ton\n\nSie-Form.\n');
    expect(applyKnowledgeOperations('', [{ op: 'add', section: 'Ton', content: 'Sie-Form.' }]).content)
      .toBe('## Ton\n\nSie-Form.\n');
    const middle = applyKnowledgeOperations('## A\n\na\n\n## B\n\nb\n\n## C\n\nc\n', [{ op: 'update', section: 'B', content: 'neu' }]);
    expect(middle.content).toBe('## A\n\na\n\n## B\n\nneu\n\n## C\n\nc\n');
  });
});

describe('diffText (TA-P5)', () => {
  it('liefert Wort-Segmente innerhalb geänderter Zeilen', () => {
    const segments = diffText('Versand in 2 Tagen.\nRückgabe 30 Tage.\n', 'Versand in 1-2 Werktagen.\nRückgabe 30 Tage.\n');
    expect(rebuild(segments)).toEqual({
      before: 'Versand in 2 Tagen.\nRückgabe 30 Tage.\n',
      after: 'Versand in 1-2 Werktagen.\nRückgabe 30 Tage.\n',
    });
    expect(segments).toEqual([
      { type: 'equal', text: 'Versand in ' },
      { type: 'insert', text: '1-' },
      { type: 'equal', text: '2 ' },
      { type: 'delete', text: 'Tagen' },
      { type: 'insert', text: 'Werktagen' },
      { type: 'equal', text: '.\nRückgabe 30 Tage.\n' },
    ]);
    expect(summarizeTextDiff(segments)).toEqual({ inserted: 2, deleted: 1 });
  });

  it('behandelt reine Einfügungen/Löschungen und identische Texte', () => {
    expect(diffText('a\n', 'a\n')).toEqual([{ type: 'equal', text: 'a\n' }]);
    expect(diffText('', 'neu')).toEqual([{ type: 'insert', text: 'neu' }]);
    expect(diffText('alt', '')).toEqual([{ type: 'delete', text: 'alt' }]);
    const added = diffText('## A\n\na\n', '## A\n\na\n\n## B\n\nb\n');
    expect(added).toEqual([{ type: 'equal', text: '## A\n\na\n' }, { type: 'insert', text: '\n## B\n\nb\n' }]);
  });

  it('bleibt bei zufälligen Änderungen verlustfrei', () => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const words = ['Versand', 'Rückgabe', 'Tage', 'Kunde', 'bitte', 'danke', '\n', ' ', '.', 'KI'];
    for (let run = 0; run < 40; run += 1) {
      const make = (n: number) => Array.from({ length: n }, () => words[Math.floor(rand() * words.length)]).join(' ');
      const a = make(30 + Math.floor(rand() * 30));
      const b = rand() < 0.5 ? make(25) : a.replace(/Tage/g, 'Werktage').slice(Math.floor(rand() * 10));
      expect(rebuild(diffText(a, b))).toEqual({ before: a, after: b });
    }
  });

  it('ist für 100 000 Zeichen mit kleinen Änderungen schnell', () => {
    const lines = Array.from({ length: 2500 }, (_, i) => `Zeile ${i}: Regel zu Versand und Rückgabe für Produktgruppe ${i % 17}.`);
    const before = lines.join('\n');
    expect(before.length).toBeGreaterThan(100_000);
    const changed = [...lines];
    changed[10] = 'Zeile 10: GEÄNDERT Versand.';
    changed.splice(1200, 1);
    changed.splice(2000, 0, 'Neue Zeile mit Regel.');
    const after = changed.join('\n');
    const started = Date.now();
    const segments = diffText(before, after);
    expect(Date.now() - started).toBeLessThan(1500);
    expect(rebuild(segments)).toEqual({ before, after });
    expect(summarizeTextDiff(segments).inserted).toBeGreaterThan(0);
  });

  it('fällt bei komplett neuem großen Text auf Block-Ersetzen zurück', () => {
    const a = Array.from({ length: 3000 }, (_, i) => `a${i}`).join('\n');
    const b = Array.from({ length: 3000 }, (_, i) => `b${i}`).join('\n');
    const segments = diffText(a, b, { maxEditDistance: 50 });
    expect(rebuild(segments)).toEqual({ before: a, after: b });
    expect(segments).toEqual([{ type: 'delete', text: a }, { type: 'insert', text: b }]);
  });
});
