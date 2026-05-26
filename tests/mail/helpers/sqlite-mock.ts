/** Lightweight SQLite mock for mail module unit tests. */
export type StmtMock = {
  all: jest.Mock;
  get: jest.Mock;
  run: jest.Mock;
};

export function createSqliteMock(): {
  db: {
    prepare: jest.Mock;
    exec: jest.Mock;
    pragma: jest.Mock;
    transaction: <T>(fn: () => T) => T;
  };
  stmt: StmtMock;
} {
  const stmt: StmtMock = {
    all: jest.fn(() => []),
    get: jest.fn(() => undefined),
    run: jest.fn(() => ({ changes: 1, lastInsertRowid: 1 })),
  };

  const transaction = jest.fn((fn: () => unknown) => {
    const run = () => fn();
    return run;
  });
  return {
    db: {
      prepare: jest.fn(() => stmt),
      exec: jest.fn(),
      pragma: jest.fn(),
      transaction,
    },
    stmt,
  };
}
