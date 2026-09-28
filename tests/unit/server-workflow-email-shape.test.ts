/**
 * @jest-environment node
 */
import {
  firstAngleBracketContent,
  hasSimpleEmailShape,
} from '../../packages/server/src/workflow-nodes/shared';

/**
 * CodeQL (polynomielles Regex): die mit Plan 043 nach workflow-nodes/
 * verschobenen Muster `^[^…]+@[^…]+\.[^…]+$` und `/<([^>]+)>/` liefen bei
 * vielen Punkten bzw. `<` ohne passendes Ende quadratisch. Die linearen Helfer
 * müssen genau dasselbe liefern wie die alten Muster.
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
