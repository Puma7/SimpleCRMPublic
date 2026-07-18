import type {
  KyselyPlugin,
  OperationNodeTransformer,
  PluginTransformQueryArgs,
  PluginTransformResultArgs,
  PrimitiveValueListNode,
  QueryId,
  QueryResult,
  RootOperationNode,
  UnknownRow,
  ValueNode,
} from 'kysely';

/**
 * True for JS arrays. node-postgres serialises a JS array parameter as a Postgres
 * array literal ({...}), which a jsonb column rejects with error 22P02. (The
 * server schema has no native Postgres array columns and no `= ANY(array)`
 * usage, so any array parameter is always destined for a jsonb column.)
 */
export function isJsonbUnsafeArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/**
 * Serialises array values to a JSON string so jsonb accepts them; leaves
 * everything else untouched — node-postgres already serialises objects, and
 * values that were already JSON.stringify'd are plain strings and pass through.
 */
export function serializeJsonbBoundValue(value: unknown): unknown {
  return isJsonbUnsafeArray(value) ? JSON.stringify(value) : value;
}

/**
 * Kysely plugin that closes the recurring "JS array → jsonb" crash class (22P02)
 * once and for all: it rewrites every array-valued bound parameter to its JSON
 * string before the query reaches node-postgres. Individual `JSON.stringify`
 * call sites become belt-and-suspenders (a stringified value is already a string,
 * so this plugin leaves it alone).
 *
 * Takes the `OperationNodeTransformer` base class as a parameter so this module
 * has no value import from `kysely` (which is mocked in unit tests).
 */
export function createJsonbArrayPlugin(
  OperationNodeTransformerClass: typeof OperationNodeTransformer,
): KyselyPlugin {
  class JsonbArrayTransformer extends OperationNodeTransformerClass {
    protected override transformValue(node: ValueNode, queryId?: QueryId): ValueNode {
      const transformed = super.transformValue(node, queryId);
      if (!isJsonbUnsafeArray(transformed.value)) return transformed;
      return {
        kind: 'ValueNode',
        value: JSON.stringify(transformed.value),
        ...(transformed.immediate === undefined ? {} : { immediate: transformed.immediate }),
      };
    }

    // Insert rows whose columns are all present with simple values are emitted
    // by Kysely as a PrimitiveValueListNode, whose elements never pass through
    // transformValue. Without this override an array value in such a row would
    // reach node-postgres unserialised and hit the same 22P02. (Verified in
    // kysely 0.28: the base transformer returns this node untouched.)
    protected override transformPrimitiveValueList(
      node: PrimitiveValueListNode,
      queryId?: QueryId,
    ): PrimitiveValueListNode {
      const transformed = super.transformPrimitiveValueList(node, queryId);
      if (!transformed.values.some(isJsonbUnsafeArray)) return transformed;
      return {
        kind: 'PrimitiveValueListNode',
        values: transformed.values.map(serializeJsonbBoundValue),
      };
    }
  }

  const transformer = new JsonbArrayTransformer();
  return {
    transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
      return transformer.transformNode(args.node, args.queryId);
    },
    async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
      return args.result;
    },
  };
}
