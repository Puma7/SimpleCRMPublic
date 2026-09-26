import { pgArrayLiteral } from '../../packages/server/src/db/pg-array';

// Native Postgres-Arrays (text[], bigint[]) gehen als Array-Literal an Postgres;
// ein JS-Array wandelt das jsonb-Array-Plugin in JSON, das Postgres dort ablehnt.
describe('pgArrayLiteral', () => {
  test('text values are quoted and escaped', () => {
    expect(pgArrayLiteral([])).toBe('{}');
    expect(pgArrayLiteral(['a', 'b c'])).toBe('{"a","b c"}');
    expect(pgArrayLiteral(['Kom,ma', 'Anf"uhrung', 'Back\\slash', '{Klammer}', 'NULL'])).toBe(
      '{"Kom,ma","Anf\\"uhrung","Back\\\\slash","{Klammer}","NULL"}',
    );
  });

  test('integers stay bare; anything else is refused', () => {
    expect(pgArrayLiteral([1, -1, 42])).toBe('{1,-1,42}');
    expect(() => pgArrayLiteral([1.5])).toThrow('not an integer');
    expect(() => pgArrayLiteral([Number.NaN])).toThrow('not an integer');
  });
});
