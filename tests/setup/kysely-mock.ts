type KyselyRawOperationNode = {
  kind: 'RawNode';
  sqlFragments: readonly string[];
  parameters: readonly KyselyValueNode[];
};

type KyselyValueNode = {
  kind: 'ValueNode';
  value: unknown;
};

function createRawBuilder(sqlFragments: TemplateStringsArray, parameters: readonly unknown[]) {
  const valueNodes = parameters.map((value) => ({ kind: 'ValueNode' as const, value }));
  const node: KyselyRawOperationNode = {
    kind: 'RawNode',
    sqlFragments: Array.from(sqlFragments),
    parameters: valueNodes,
  };

  return {
    toOperationNode() {
      return node;
    },
    as(alias: string) {
      return {
        alias,
        toOperationNode() {
          return node;
        },
      };
    },
    async execute(executorProvider: {
      getExecutor?: () => {
        transformQuery?: (node: KyselyRawOperationNode) => KyselyRawOperationNode;
        compileQuery?: (node: KyselyRawOperationNode) => { sql: string; parameters: readonly unknown[] };
        executeQuery?: (compiled: { sql: string; parameters: readonly unknown[] }) => Promise<unknown>;
      };
    }) {
      const executor = executorProvider.getExecutor?.();
      if (!executor?.executeQuery) throw new Error('missing fake Kysely executor');
      const transformed = executor.transformQuery?.(node) ?? node;
      const compiled = executor.compileQuery?.(transformed) ?? {
        sql: Array.from(sqlFragments)
          .map((fragment, index) => `${fragment}${index < parameters.length ? `$${index + 1}` : ''}`)
          .join(''),
        parameters,
      };
      return executor.executeQuery(compiled);
    },
  };
}

export const sql = Object.assign(
  (sqlFragments: TemplateStringsArray, ...parameters: unknown[]) => createRawBuilder(sqlFragments, parameters),
  {
    ref: (reference: string) => createRawBuilder([reference] as unknown as TemplateStringsArray, []),
  },
);
