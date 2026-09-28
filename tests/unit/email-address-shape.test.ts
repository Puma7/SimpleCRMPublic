/**
 * @jest-environment node
 */
import {
  firstAngleBracketContent,
  hasSimpleEmailShape,
  trailingAngleBracketContent,
} from '../../packages/core/src/email/email-address-shape';
import { outboundDraftFingerprint } from '../../packages/core/src/email/outbound-approval-marker';
import * as serverShared from '../../packages/server/src/workflow-nodes/shared';

/**
 * CodeQL (polynomielles Regex): die Muster `^[^…]+@[^…]+\.[^…]+$`,
 * `/<([^>]+)>/` und `/^(.+)<([^>]+)>$/` liefen bei vielen Punkten bzw. `<` ohne
 * passendes Ende quadratisch (workflow-nodes/, Freigabe-Fingerprint). Die
 * linearen Helfer in @simplecrm/core müssen genau dasselbe liefern.
 */
const OLD_EMAIL = {
  plain: /^[^@\s]+@[^@\s]+\.[^@\s]+$/,
  angle: /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/,
  jtl: /^[^\s@'";\\]+@[^\s@'";\\]+\.[^\s@'";\\]+$/,
};
const FORBIDDEN = { plain: '', angle: '<>', jtl: '\'";\\' };

const samples = [
  '', '@', 'a@b', 'a@b.', 'a@.b', 'a@b.c', '@b.c', 'a@@b.c', 'a@b@c.d', 'a.b@c.d', 'a@b..c', 'a@..', 'a@x.',
  'a b@c.d', 'a@c.d ', ' a@c.d', 'a@c .d', 'a@c.d\n', 'a<b@c.d', 'a@c.d>', 'o\'hara@x.de', 'a"b@c.d', 'a;b@c.d', 'a\\b@c.d',
  'kunde@example.com', 'KUNDE@Example.COM', 'x@y.z', 'x@y.zz.', 'ä@ö.ü', '😀@😀.😀', 'a@b.c.d.e', 'a@.', 'a@.b.', '.@.b.c',
];

function randomSamples(count: number): string[] {
  const alphabet = ['a', 'b', '.', '@', ' ', '<', '>', '"', '\'', ';', '\\', '\t'];
  const out: string[] = [];
  let seed = 7;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed;
  };
  for (let i = 0; i < count; i += 1) {
    const length = next() % 9;
    let text = '';
    for (let j = 0; j < length; j += 1) text += alphabet[next() % alphabet.length];
    out.push(text);
  }
  return out;
}

describe('hasSimpleEmailShape', () => {
  test.each(Object.keys(OLD_EMAIL) as Array<keyof typeof OLD_EMAIL>)('gleiches Ergebnis wie das alte Muster (%s)', (kind) => {
    for (const value of [...samples, ...randomSamples(4000)]) {
      expect([value, hasSimpleEmailShape(value, FORBIDDEN[kind])]).toEqual([value, OLD_EMAIL[kind].test(value)]);
    }
  });

  test('bleibt schnell bei vielen Punkten ohne passendes Ende', () => {
    const hostile = `a@${'a.'.repeat(50_000)}@`;
    const started = Date.now();
    expect(hasSimpleEmailShape(hostile, '<>')).toBe(false);
    expect(hasSimpleEmailShape(`a@${'.'.repeat(100_000)}`)).toBe(true);
    expect(Date.now() - started).toBeLessThan(200);
  });
});

describe('firstAngleBracketContent', () => {
  const old = (value: string) => {
    const match = value.match(/<([^>]+)>/);
    return match ? match[1]! : null;
  };

  test('gleiches Ergebnis wie /<([^>]+)>/', () => {
    const cases = [
      '', '<>', '<a>', 'Name <a@b.c>', '<><a>', '<<a>', 'a<b', 'a>b<c>', '<a><b>', '<<>>', '<a<b>', 'x <> y <z>', '<', '>',
    ];
    const alphabet = ['<', '>', 'a', ' '];
    let seed = 3;
    for (let i = 0; i < 4000; i += 1) {
      let text = '';
      for (let j = 0; j < i % 8; j += 1) {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        text += alphabet[seed % alphabet.length];
      }
      cases.push(text);
    }
    for (const value of cases) expect([value, firstAngleBracketContent(value)]).toEqual([value, old(value)]);
  });

  test('bleibt schnell bei vielen „<“ ohne „>“', () => {
    const started = Date.now();
    expect(firstAngleBracketContent('<'.repeat(100_000))).toBeNull();
    expect(firstAngleBracketContent(`${'<'.repeat(100_000)}a>`)).toBe(`${'<'.repeat(99_999)}a`);
    expect(Date.now() - started).toBeLessThan(200);
  });
});

describe('trailingAngleBracketContent', () => {
  const old = (value: string) => {
    const match = value.match(/^(.+)<([^>]+)>$/);
    return match ? match[2]! : null;
  };

  test('gleiches Ergebnis wie /^(.+)<([^>]+)>$/', () => {
    const cases = [
      '', '>', '<>', '<a>', 'a<>', 'a<b>', 'Name <a@b.c>', 'a<b<c>', 'a<b>c>', 'a<b>>', 'x<y> <z>', '\n<a>',
      'a\n<b>', 'a<b\nc>', 'a\r<b>', 'a\u2028<b>', '<a<b>', 'a<<b>', 'a <b> c <d>', 'a<b>\n',
    ];
    const alphabet = ['<', '>', 'a', ' ', '\n', '\r'];
    let seed = 11;
    for (let i = 0; i < 6000; i += 1) {
      let text = '';
      for (let j = 0; j < i % 9; j += 1) {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        text += alphabet[seed % alphabet.length];
      }
      cases.push(text);
    }
    for (const value of cases) expect([value, trailingAngleBracketContent(value)]).toEqual([value, old(value)]);
  });

  test('bleibt schnell bei vielen „<“ und „>“ ohne passendes Ende', () => {
    const started = Date.now();
    expect(trailingAngleBracketContent(`a${'=<='.repeat(50_000)}`)).toBeNull();
    // Mindestens ein Zeichen zwischen `<` und `>`: das vorletzte `<` gewinnt.
    expect(trailingAngleBracketContent(`a${'<'.repeat(100_000)}>`)).toBe('<');
    expect(Date.now() - started).toBeLessThan(200);
  });
});

describe('Freigabe-Fingerprint unverändert', () => {
  // Werte mit dem bisherigen Regex-Code berechnet (vor der Umstellung): ändern
  // sie sich, gälten gespeicherte Freigabe-Marker nicht mehr.
  test('Empfänger mit Namen, Klammern und Zeilenumbruch', () => {
    expect([
      { subject: 'Hallo', bodyText: 'x', to: 'Max Muster <Max@Example.COM>, b@c.de', cc: 'Name <kaputt>', bcc: '' },
      { to: 'a<b@c.de>;  "Müller, A" <mueller@firma.de> ; ohne-adresse', cc: 'x <y@z.io> <q@r.st>', bcc: 'Zeile\n<neu@z.de>' },
      { to: '<a@b.c>', cc: 'a <b <c@d.ef>', bcc: 'a>b <c@d.ef>' },
    ].map((input) => outboundDraftFingerprint(input))).toEqual([
      'aaad09d6929bde8924c924cf047e9fb7',
      '47496fd0565de45e82fffaaacdd79ac9',
      'ce9f09768ed4075e329a57ba1309ff91',
    ]);
  });
});

describe('Server-Knoten nutzen dieselben Helfer', () => {
  test('workflow-nodes/shared reicht die Core-Funktionen weiter', () => {
    expect(serverShared.hasSimpleEmailShape).toBe(hasSimpleEmailShape);
    expect(serverShared.firstAngleBracketContent).toBe(firstAngleBracketContent);
  });
});
