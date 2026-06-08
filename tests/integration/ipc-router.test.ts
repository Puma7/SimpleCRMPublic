const makeRegisterMock = () => jest.fn(() => jest.fn());

const registerWindowHandlers = makeRegisterMock();
const registerDatabaseHandlers = makeRegisterMock();
const registerDealHandlers = makeRegisterMock();
const registerTaskHandlers = makeRegisterMock();
const registerCalendarHandlers = makeRegisterMock();
const registerCustomFieldHandlers = makeRegisterMock();
const registerSyncHandlers = makeRegisterMock();
const registerDashboardHandlers = makeRegisterMock();
const registerMssqlHandlers = makeRegisterMock();
const registerJtlHandlers = makeRegisterMock();
const registerUpdateHandlers = makeRegisterMock();
const registerEmailHandlers = makeRegisterMock();
const registerWorkflowHandlers = makeRegisterMock();
const registerFollowUpHandlers = makeRegisterMock();
const registerAutomationHandlers = makeRegisterMock();
const registerAuthHandlers = makeRegisterMock();
const registerPgpHandlers = makeRegisterMock();
const registerSetupHandlers = makeRegisterMock();
const registerDiagnosticsHandlers = makeRegisterMock();
const registerMaintenanceHandlers = makeRegisterMock();

jest.mock('../../electron/ipc/window', () => ({ registerWindowHandlers }));
jest.mock('../../electron/ipc/database', () => ({ registerDatabaseHandlers }));
jest.mock('../../electron/ipc/deals', () => ({ registerDealHandlers }));
jest.mock('../../electron/ipc/tasks', () => ({ registerTaskHandlers }));
jest.mock('../../electron/ipc/calendar', () => ({ registerCalendarHandlers }));
jest.mock('../../electron/ipc/custom-fields', () => ({ registerCustomFieldHandlers }));
jest.mock('../../electron/ipc/sync', () => ({ registerSyncHandlers }));
jest.mock('../../electron/ipc/dashboard', () => ({ registerDashboardHandlers }));
jest.mock('../../electron/ipc/mssql', () => ({ registerMssqlHandlers }));
jest.mock('../../electron/ipc/jtl', () => ({ registerJtlHandlers }));
jest.mock('../../electron/ipc/update', () => ({ registerUpdateHandlers }));
jest.mock('../../electron/ipc/email', () => ({ registerEmailHandlers }));
jest.mock('../../electron/ipc/workflow', () => ({ registerWorkflowHandlers }));
jest.mock('../../electron/ipc/followup', () => ({ registerFollowUpHandlers }));
jest.mock('../../electron/ipc/automation', () => ({ registerAutomationHandlers }));
jest.mock('../../electron/ipc/auth', () => ({ registerAuthHandlers }));
jest.mock('../../electron/ipc/pgp', () => ({ registerPgpHandlers }));
jest.mock('../../electron/ipc/setup', () => ({ registerSetupHandlers }));
jest.mock('../../electron/ipc/diagnostics', () => ({ registerDiagnosticsHandlers }));
jest.mock('../../electron/ipc/maintenance', () => ({ registerMaintenanceHandlers }));

import { registerAllIpcHandlers } from '../../electron/ipc/router';

describe('registerAllIpcHandlers', () => {
  test('registers all handler domains and calls disposers', () => {
    const dispose = registerAllIpcHandlers({
      logger: console,
      isDevelopment: false,
      getMainWindow: () => null as any,
    });

    expect(registerWindowHandlers).toHaveBeenCalled();
    expect(registerDiagnosticsHandlers).toHaveBeenCalled();
    expect(registerMaintenanceHandlers).toHaveBeenCalled();
    expect(registerSetupHandlers).toHaveBeenCalled();
    expect(registerDatabaseHandlers).toHaveBeenCalled();
    expect(registerDealHandlers).toHaveBeenCalled();
    expect(registerTaskHandlers).toHaveBeenCalled();
    expect(registerCalendarHandlers).toHaveBeenCalled();
    expect(registerCustomFieldHandlers).toHaveBeenCalled();
    expect(registerSyncHandlers).toHaveBeenCalled();
    expect(registerDashboardHandlers).toHaveBeenCalled();
    expect(registerMssqlHandlers).toHaveBeenCalled();
    expect(registerJtlHandlers).toHaveBeenCalled();
    expect(registerUpdateHandlers).toHaveBeenCalled();
    expect(registerEmailHandlers).toHaveBeenCalled();
    expect(registerWorkflowHandlers).toHaveBeenCalled();
    expect(registerFollowUpHandlers).toHaveBeenCalled();
    expect(registerAutomationHandlers).toHaveBeenCalled();
    expect(registerAuthHandlers).toHaveBeenCalled();
    expect(registerPgpHandlers).toHaveBeenCalled();

    expect(typeof dispose).toBe('function');
    dispose();
  });
});
