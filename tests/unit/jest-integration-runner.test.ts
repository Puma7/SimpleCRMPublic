const jestConfig = require('../../jest.config.cjs') as {
  projects: Array<{ displayName?: string; runner?: string }>;
};

describe('Jest integration runner', () => {
  test('serializes integration suites that own embedded PostgreSQL processes', () => {
    const integrationProject = jestConfig.projects.find((project) => project.displayName === 'integration');

    expect(integrationProject?.runner).toBe('<rootDir>/tests/setup/serial-jest-runner.cjs');
  });
});
