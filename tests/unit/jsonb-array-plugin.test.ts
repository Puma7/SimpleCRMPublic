import {
  createJsonbArrayPlugin,
  isJsonbUnsafeArray,
  serializeJsonbBoundValue,
} from '../../packages/server/src/db/jsonb-array-plugin';

// Structural safeguard against the recurring "JS array -> jsonb" crash (22P02).

describe('jsonb bound-value helpers', () => {
  test('isJsonbUnsafeArray detects only arrays', () => {
    expect(isJsonbUnsafeArray(['a'])).toBe(true);
    expect(isJsonbUnsafeArray([])).toBe(true);
    expect(isJsonbUnsafeArray({ a: 1 })).toBe(false);
    expect(isJsonbUnsafeArray('a')).toBe(false);
    expect(isJsonbUnsafeArray(null)).toBe(false);
  });

  test('serializeJsonbBoundValue stringifies arrays, leaves the rest', () => {
    expect(serializeJsonbBoundValue(['a', 'b'])).toBe('["a","b"]');
    expect(serializeJsonbBoundValue({ a: 1 })).toEqual({ a: 1 });
    expect(serializeJsonbBoundValue('s')).toBe('s');
    expect(serializeJsonbBoundValue(42)).toBe(42);
    expect(serializeJsonbBoundValue(null)).toBeNull();
  });
});

// Minimal stand-in for Kysely's OperationNodeTransformer: recursively walks the
// node tree and dispatches ValueNodes to `transformValue`, exactly like the real
// base class does (which we trust). Lets us verify the plugin's override rewrites
// array ValueNodes anywhere in the tree without the real (mocked) kysely.
class FakeOperationNodeTransformer {
  transformNode(node: unknown): unknown {
    if (node === null || node === undefined) return node;
    if (Array.isArray(node)) return node.map((child) => this.transformNode(child));
    if (typeof node === 'object') {
      const record = node as Record<string, unknown>;
      if (record.kind === 'ValueNode') {
        return (this as unknown as { transformValue(n: unknown): unknown }).transformValue(record);
      }
      if (record.kind === 'PrimitiveValueListNode') {
        return (this as unknown as {
          transformPrimitiveValueList(n: unknown): unknown;
        }).transformPrimitiveValueList(record);
      }
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(record)) out[key] = this.transformNode(value);
      return out;
    }
    return node;
  }

  protected transformValue(node: unknown): unknown {
    return node;
  }

  // The real base class returns the PrimitiveValueListNode untouched — mirror
  // that so the plugin's override is what does the work.
  protected transformPrimitiveValueList(node: unknown): unknown {
    return node;
  }
}

describe('createJsonbArrayPlugin', () => {
  test('rewrites array-valued ValueNodes to JSON strings, leaving others intact', () => {
    const plugin = createJsonbArrayPlugin(FakeOperationNodeTransformer as never);
    const node = {
      kind: 'InsertQueryNode',
      into: { kind: 'TableNode', table: 'ai_usage_events' },
      values: {
        kind: 'ValuesNode',
        values: [
          { kind: 'ValueNode', value: ['webhook:fire', 'mail:read'] },
          { kind: 'ValueNode', value: { origin: 'server' } },
          { kind: 'ValueNode', value: 'plain' },
          { kind: 'ValueNode', value: 7 },
          { kind: 'ValueNode', value: null },
        ],
      },
    };

    const result = plugin.transformQuery({ node, queryId: { queryId: 'q1' } } as never) as {
      values: { values: Array<{ value: unknown }> };
    };
    const values = result.values.values.map((v) => v.value);

    expect(values[0]).toBe('["webhook:fire","mail:read"]');
    expect(values[1]).toEqual({ origin: 'server' });
    expect(values[2]).toBe('plain');
    expect(values[3]).toBe(7);
    expect(values[4]).toBeNull();
  });

  test('rewrites array elements in an all-primitive insert row (PrimitiveValueListNode)', () => {
    // Kysely emits this node for insert rows whose columns are all present with
    // simple values — the path that previously bypassed the plugin and caused
    // the tracking 22P02 crash.
    const plugin = createJsonbArrayPlugin(FakeOperationNodeTransformer as never);
    const node = {
      kind: 'InsertQueryNode',
      into: { kind: 'TableNode', table: 'email_tracking_event_classifications' },
      values: {
        kind: 'ValuesNode',
        values: [
          {
            kind: 'PrimitiveValueListNode',
            values: [['scanner', 'no_ua'], { origin: 'server' }, 'plain', 7, null],
          },
        ],
      },
    };

    const result = plugin.transformQuery({ node, queryId: { queryId: 'q2' } } as never) as {
      values: { values: Array<{ values: unknown[] }> };
    };
    const values = result.values.values[0]!.values;

    expect(values[0]).toBe('["scanner","no_ua"]');
    expect(values[1]).toEqual({ origin: 'server' });
    expect(values[2]).toBe('plain');
    expect(values[3]).toBe(7);
    expect(values[4]).toBeNull();
  });

  test('leaves a PrimitiveValueListNode without arrays untouched', () => {
    const plugin = createJsonbArrayPlugin(FakeOperationNodeTransformer as never);
    const node = {
      kind: 'InsertQueryNode',
      values: {
        kind: 'ValuesNode',
        values: [{ kind: 'PrimitiveValueListNode', values: ['a', 2, null] }],
      },
    };
    const result = plugin.transformQuery({ node, queryId: { queryId: 'q3' } } as never) as {
      values: { values: Array<{ values: unknown[] }> };
    };
    expect(result.values.values[0]!.values).toEqual(['a', 2, null]);
  });

  test('transformResult passes the result through unchanged', async () => {
    const plugin = createJsonbArrayPlugin(FakeOperationNodeTransformer as never);
    const result = { rows: [{ a: 1 }] };
    await expect(plugin.transformResult({ result } as never)).resolves.toBe(result);
  });
});
