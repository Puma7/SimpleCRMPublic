import { BrowserWindow } from 'electron';
import { registerWindowHandlers } from './window';
import { registerDatabaseHandlers } from './database';
import { registerDealHandlers } from './deals';
import { registerTaskHandlers } from './tasks';
import { registerCalendarHandlers } from './calendar';
import { registerCustomFieldHandlers } from './custom-fields';
import { registerSyncHandlers } from './sync';
import { registerDashboardHandlers } from './dashboard';
import { registerMssqlHandlers } from './mssql';
import { registerJtlHandlers } from './jtl';
import { registerUpdateHandlers } from './update';
import { registerEmailHandlers } from './email';
import { registerWorkflowHandlers } from './workflow';
import { registerFollowUpHandlers } from './followup';
import { registerAutomationHandlers } from './automation';
import { registerAuthHandlers } from './auth';
import { registerPgpHandlers } from './pgp';
import { registerSetupHandlers } from './setup';

interface IpcRouterOptions {
  logger: Pick<typeof console, 'debug' | 'info' | 'warn' | 'error'>;
  isDevelopment: boolean;
  getMainWindow: () => BrowserWindow | null;
}

type Disposer = () => void;

export function registerAllIpcHandlers(options: IpcRouterOptions) {
  const { logger, isDevelopment, getMainWindow } = options;
  const disposers: Disposer[] = [];

  disposers.push(registerWindowHandlers({ getMainWindow, logger }));
  disposers.push(registerSetupHandlers({ logger }));
  disposers.push(registerDatabaseHandlers({ logger, isDevelopment }));
  disposers.push(registerDealHandlers({ logger, isDevelopment }));
  disposers.push(registerTaskHandlers({ logger }));
  disposers.push(registerCalendarHandlers({ logger }));
  disposers.push(registerCustomFieldHandlers({ logger }));
  disposers.push(registerSyncHandlers({ logger, getMainWindow }));
  disposers.push(registerDashboardHandlers({ logger }));
  disposers.push(registerMssqlHandlers({ logger, isDevelopment }));
  disposers.push(registerJtlHandlers({ logger }));
  disposers.push(registerUpdateHandlers({ logger }));
  disposers.push(registerEmailHandlers({ logger, isDevelopment }));
  disposers.push(registerWorkflowHandlers({ logger }));
  disposers.push(registerFollowUpHandlers({ logger }));
  disposers.push(registerAutomationHandlers({ logger }));
  disposers.push(registerAuthHandlers({ logger, getMainWindow }));
  disposers.push(registerPgpHandlers({ logger }));

  return () => {
    disposers.forEach((dispose) => dispose());
  };
}
