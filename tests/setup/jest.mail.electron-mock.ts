/** Runs before mail test files load sqlite-service (which calls app.getPath at import time). */
jest.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/simplecrm-mail-test',
    getName: () => 'simplecrm-test',
  },
}));
