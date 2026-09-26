/**
 * TA-P5 Sicherheits-Review: Der Learnings-Datenschutzfilter läuft auf fremdem
 * Mail-Inhalt. Jedes Muster und jede Funktion muss auf entarteten 200-KB-
 * Eingaben linear bleiben (vorher: 100 KB „a-a-…“ → 23 s, Event-Loop blockiert).
 */
import {
  clampLearningSource,
  extractLearningReplyText,
  LEARNING_REDACTION_PATTERNS_FOR_TESTS,
  LEARNING_REPLY_NOISE_PATTERNS_FOR_TESTS,
  LEARNING_SOURCE_TEXT_MAX_LENGTH,
  learningHtmlToText,
  prepareNoteLearningCandidate,
  prepareSentLearningCandidate,
  redactPersonalData,
  stripReplyNoise,
} from '../../packages/core/src/learnings';

const SIZE = 200_000;
const BUDGET_MS = 200;

function repeatTo(unit: string, size = SIZE): string {
  return unit.repeat(Math.ceil(size / unit.length)).slice(0, size);
}

const DEGENERATE: Record<string, string> = {
  x: repeatTo('x'),
  'a-': repeatTo('a-'),
  'ä-': repeatTo('ä-'),
  'a.b-c_': repeatTo('a.b-c_'),
  'a@': repeatTo('a@'),
  'a@b-…': `a@${repeatTo('b-')}`,
  'a@b.…1': `a@${repeatTo('b.')}1`,
  digits: repeatTo('1'),
  '0 1': repeatTo('0 1'),
  '+1 ': repeatTo('+1 '),
  '+1 digits .5': `+1 ${repeatTo('1')}.5`,
  '012 digits .5': ` 012 ${repeatTo('1')}.5`,
  '#digits- ': ` #${repeatTo('1')}- `,
  '#digits_': ` #${repeatTo('1')}_`,
  spaces: `x${repeatTo(' ')}x`,
  'spaces/tabs': repeatTo(' \t'),
  newlines: `x${repeatTo('\n')}`,
  '<!--': repeatTo('<!--'),
  '<blockquote': repeatTo('<blockquote'),
  '<script': repeatTo('<script'),
  '<head': repeatTo('<head'),
  '<li': repeatTo('<li'),
  '<': repeatTo('<'),
  'www.': repeatTo('www.'),
  'http://a': repeatTo('http://a'),
  AB12: repeatTo('AB12'),
  'DE12 ': repeatTo('DE12 '),
  'BIC spaces': `BIC${repeatTo(' ')}!`,
  'Bestellnummer spaces': `Bestellnummer${repeatTo(' ')}!`,
  'Bestellnummer A': repeatTo('Bestellnummer A'),
  'Tel spaces': `Tel${repeatTo(' ')}!`,
  'Tel: 1 ': repeatTo('Tel: 1 '),
  'Herr Ab ': repeatTo('Herr Ab '),
  'Herr spaces': `Herr${repeatTo(' ')}x`,
  'aStraße ': repeatTo('aStraße '),
  '12345 Berlin\\n': repeatTo('12345 Berlin\n'),
  '12345 spaces': ` 12345${repeatTo(' ')}x`,
  '1 Abc ': repeatTo('1 Abc '),
  'Am schrieb': `Am ${repeatTo('schrieb')}`,
  'Am lines': repeatTo(`Am ${'schrieb '.repeat(30)}\n`),
  'On lines': repeatTo(`On ${'x'.repeat(190)}\n${'y'.repeat(190)}\n`),
  'Von: a\\n': repeatTo('Von: a\n'),
  '> ': repeatTo('> '),
  'Grüße ': repeatTo('Grüße '),
  realistic: repeatTo('Hallo Herr Müller,\nbitte an Musterstraße 5, 12345 Berlin. Tel. 0761 123456, max@kunde.test, Bestellnummer 123456.\n\n'),
};

/** Zeit in ms; bei Überschreitung einmal wiederholen (GC/Warm-up), das Minimum zählt. */
function measure(run: () => unknown): number {
  const once = () => {
    const start = process.hrtime.bigint();
    run();
    return Number(process.hrtime.bigint() - start) / 1e6;
  };
  const first = once();
  return first <= BUDGET_MS ? first : Math.min(first, once());
}

function slowInputs(run: (input: string) => unknown): string[] {
  const slow: string[] = [];
  for (const [name, input] of Object.entries(DEGENERATE)) {
    const ms = measure(() => run(input));
    if (ms > BUDGET_MS) slow.push(`${name}: ${Math.round(ms)} ms`);
  }
  return slow;
}

const PATTERNS = Object.entries({
  ...LEARNING_REDACTION_PATTERNS_FOR_TESTS,
  ...LEARNING_REPLY_NOISE_PATTERNS_FOR_TESTS,
});

describe('Learnings-Datenschutzfilter: lineare Laufzeit (TA-P5)', () => {
  jest.setTimeout(120_000);

  test.each(PATTERNS)('Muster %s bleibt je 200-KB-Eingabe unter 200 ms', (_name, pattern) => {
    const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    expect(slowInputs((input) => input.replace(global, ''))).toEqual([]);
  });

  test.each([
    ['redactPersonalData', (input: string) => redactPersonalData(input, { names: ['Max Mustermann', 'max.mustermann@kunde.test'] })],
    ['redactPersonalData mit keepExisting', (input: string) => redactPersonalData(input, { keepExisting: input.slice(0, 50_000) })],
    ['stripReplyNoise', (input: string) => stripReplyNoise(input)],
    ['learningHtmlToText', (input: string) => learningHtmlToText(input)],
    ['extractLearningReplyText (HTML-Zone)', (input: string) => extractLearningReplyText({ html: `<!-- simplecrm-body -->${input}` })],
    ['prepareSentLearningCandidate (große Eltern-Mail)', (input: string) => prepareSentLearningCandidate({
      aiSnapshot: 'Die Rückgabe ist innerhalb von 14 Tagen möglich.',
      sentText: `Die Rückgabe ist innerhalb von 30 Tagen möglich.\n\n${input}`,
      parentSubject: 'Rückgabe',
      parentText: input,
      parentHtml: input,
      names: ['Max Mustermann'],
    })],
    ['prepareNoteLearningCandidate (große Mail)', (input: string) => prepareNoteLearningCandidate({
      note: 'Rücksendungen sind 30 Tage kostenlos.',
      questionSubject: input,
      questionText: '',
      questionHtml: input,
    })],
  ])('%s bleibt je 200-KB-Eingabe unter 200 ms', (_name, run) => {
    expect(slowInputs(run)).toEqual([]);
  });

  test('viele Namenshinweise sind begrenzt', () => {
    const names = Array.from({ length: 5000 }, (_, i) => `Person${i} Nachname${i}`);
    const text = repeatTo('Person1 Nachname1 fragt nach der Rückgabe. ', 20_000);
    expect(measure(() => redactPersonalData(text, { names }))).toBeLessThan(1000);
  });
});

describe('Learnings-Quellen werden vor der Verarbeitung gekürzt (TA-P5)', () => {
  const late = 'SPAETERTEXTNACHDERGRENZE';

  test('Eltern-Mail (Text und HTML) und Notiz-Bezug', () => {
    const longText = `${'Wie lange dauert die Rückgabe? '.repeat(2000)}${late}`;
    expect(longText.length).toBeGreaterThan(LEARNING_SOURCE_TEXT_MAX_LENGTH);
    const sent = prepareSentLearningCandidate({
      sentText: 'Die Rückgabe dauert 30 Tage.',
      parentSubject: 'Rückgabe',
      parentText: longText,
    });
    expect(sent?.kind).toBe('human_reply');
    expect(sent?.questionText).not.toContain(late);

    const note = prepareNoteLearningCandidate({
      note: 'Rückgabe 30 Tage.',
      questionSubject: 'Rückgabe',
      questionHtml: `<p>${'Frage zur Rückgabe. '.repeat(10_000)}</p><p>${late}</p>`,
    });
    expect(note?.questionText).toContain('Frage zur Rückgabe.');
    expect(note?.questionText).not.toContain(late);
  });

  test('Antwort: Zonen-Marker werden im ganzen HTML gefunden, gekürzt wird die Zone', () => {
    const filler = `<p>${'x '.repeat(80_000)}</p>`;
    const html = `<!-- simplecrm-body --><p>Antwort vorne.</p>${filler}<!-- simplecrm-signature --><p>Signatur ${late}</p>`;
    const reply = extractLearningReplyText({ html });
    expect(reply.startsWith('Antwort vorne.')).toBe(true);
    expect(reply).not.toContain(late);
    expect(reply.length).toBeLessThanOrEqual(LEARNING_SOURCE_TEXT_MAX_LENGTH);
    expect(clampLearningSource(null)).toBe('');
  });

  test('HTML-Umwandlung verhält sich wie vorher', () => {
    expect(learningHtmlToText(
      '<head><title>t</title></head><style>p{}</style><p>Hallo<!-- k -->&nbsp;Welt</p>'
      + '<blockquote>Zitat</blockquote><ul><li class="a">Eins</li><li>Zwei</li></ul><script>x()</script>'
      + 'offen <!-- ohne Ende',
    )).toBe('Hallo Welt\n\n- Eins\n- Zwei\noffen <!-- ohne Ende');
    expect(learningHtmlToText('a<br>b<br/>c<BR />d')).toBe('a\nb\nc\nd');
  });

  test('Muster-Umbau ändert keine Treffer', () => {
    expect(redactPersonalData('Mail an max.mustermann@kunde.test bitte.')).toBe('Mail an [E-Mail] bitte.');
    expect(redactPersonalData('Kontakt: a-b.c_d+tag@sub.kunde.de')).toBe('Kontakt: [E-Mail]');
    expect(redactPersonalData('BIC : DEUTDEFF500')).toBe('BIC : [BIC]');
    expect(redactPersonalData('Bestellnummer:\n  123456')).toBe('Bestellnummer:\n  [Nummer]');
    expect(redactPersonalData('Bestellung Nr. 4711-2')).toBe('Bestellung Nr. [Nummer]');
    expect(redactPersonalData('Ticket #  98765')).toBe('Ticket #  [Nummer]');
    expect(redactPersonalData('siehe #12345-AB')).toBe('siehe #[Nummer]');
    expect(redactPersonalData('Tel.:  0761 123456')).toBe('Tel.:  [Telefon]');
    expect(redactPersonalData('Wohnt in der Rhein-Main-Hauptstraße 12a.')).toBe('Wohnt in der [Adresse].');
    // Straßennamen mit Umlaut am Anfang werden jetzt ganz ersetzt (vorher blieb „Ü“ stehen).
    expect(redactPersonalData('Überweg 5, bitte')).toBe('[Adresse], bitte');
    expect(redactPersonalData('Lieferung an\n12345 Berlin')).toBe('Lieferung an\n[Adresse]');
    expect(redactPersonalData('Wir haben 12345 Kunden')).toBe('Wir haben 12345 Kunden');
    expect(stripReplyNoise('Text   \nmehr\t\n')).toBe('Text\nmehr');
  });
});
