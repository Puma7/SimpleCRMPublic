import { isStrictBase64Payload } from '../../packages/core/src/base64';

const LEGACY = /^[A-Za-z0-9+/]+={0,2}$/;

// Large Base64 uploads (compose attachments, PGP attachments, desktop IPC) were
// validated with LEGACY. In CI a 27M-character upload made RegExp.test throw
// "Maximum call stack size exceeded" once the V8 flag for the linear regexp
// fallback (F-A13A14-04, E1) was active in the process; the API and the desktop
// main process now always run with that flag.
describe('isStrictBase64Payload', () => {
  test('agrees with the previous regex on small inputs', () => {
    const samples = ['', '=', '==', 'A', 'AA==', 'AAA=', 'AAAA', 'AA===', 'A=A', 'A-B_', 'ab+/', 'ä', ' AAAA', 'AAAA\n'];
    for (const sample of samples) expect(isStrictBase64Payload(sample)).toBe(LEGACY.test(sample));
    const alphabet = 'AZaz09+/=-_ \n.';
    let seed = 11;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed;
    };
    for (let i = 0; i < 20_000; i += 1) {
      let value = '';
      const length = next() % 12;
      for (let j = 0; j < length; j += 1) value += alphabet[next() % alphabet.length];
      expect(isStrictBase64Payload(value)).toBe(LEGACY.test(value));
    }
  });

  test('handles a 40M-character payload without recursion', () => {
    const payload = Buffer.alloc(30 * 1024 * 1024, 7).toString('base64');
    expect(payload.length).toBeGreaterThan(40_000_000);
    expect(isStrictBase64Payload(payload)).toBe(true);
    expect(isStrictBase64Payload(`${payload.slice(0, -4)}AA!=`)).toBe(false);
  });
});
