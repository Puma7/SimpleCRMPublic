import { handleAuthRoute } from './auth-routes';
import { handleAuthSecurityRoute } from './auth-security-routes';
import { handleAutomationReadRoute } from './automation-routes';
import { handleCoreCrmReadRoute } from './core-crm-routes';
import { handleCustomerRoute } from './customer-routes';
import { handleDashboardRoute } from './dashboard-routes';
import { handleDiagnosticsRoute } from './diagnostics-routes';
import { handleExtendedCrmReadRoute } from './extended-crm-routes';
import { handleFollowUpRoute } from './follow-up-routes';
import { handleLockRoute } from './lock-routes';
import { handleMailReadRoute } from './mail-routes';
import { handleMaintenanceRoute } from './maintenance-routes';
import { handleNoticeRoute } from './notice-routes';
import { handlePgpReadRoute } from './pgp-routes';
import { handlePublicPortalRoute, handleReturnsRoute } from './returns-routes';
import { handleSpamReadRoute } from './spam-routes';
import { handleSettingsRoute } from './settings-routes';
import { handleUserGroupRoute } from './user-group-routes';
import { handleWorkflowReadRoute } from './workflow-routes';
import { getServerOpenApiSpec } from './openapi';
import type { ApiRequest, ApiResponse, ServerApiPorts } from './types';
import { data, error } from './types';

export type ServerApi = {
  handle(req: ApiRequest): Promise<ApiResponse>;
};

export function createServerApi(ports: ServerApiPorts): ServerApi {
  return {
    async handle(req: ApiRequest): Promise<ApiResponse> {
      if (req.path === '/health' || req.path === '/api/v1/health') {
        if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
        return data(200, {
          status: 'ok',
          api: 'simplecrm-server',
          version: 1,
        });
      }
      // Public portal routes MUST be matched before the authenticated dispatchers,
      // because they intentionally have no principal. They return null when the
      // path is not /api/v1/portal/..., so the rest of the dispatcher is unaffected.
      const publicPortal = await handlePublicPortalRoute(req, ports);
      if (publicPortal) return publicPortal;

      if (req.path === '/health/ready' || req.path === '/api/v1/health/ready') {
        if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
        if (!ports.health) {
          return data(200, {
            status: 'ok',
            api: 'simplecrm-server',
            version: 1,
            checks: { database: 'skipped' },
          });
        }
        try {
          await ports.health.pingDatabase();
        } catch {
          return error(503, 'database_unavailable', 'Datenbank nicht erreichbar');
        }
        return data(200, {
          status: 'ok',
          api: 'simplecrm-server',
          version: 1,
          checks: { database: 'ok' },
        });
      }
      if (req.path === '/openapi.json' || req.path === '/api/v1/openapi.json') {
        if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
        return {
          status: 200,
          body: getServerOpenApiSpec(),
        };
      }

      const authSecurity = await handleAuthSecurityRoute(req, ports);
      if (authSecurity) return authSecurity;

      const auth = await handleAuthRoute(req, ports);
      if (auth) return auth;

      const automation = await handleAutomationReadRoute(req, ports);
      if (automation) return automation;

      const customers = await handleCustomerRoute(req, ports);
      if (customers) return customers;

      const userGroups = await handleUserGroupRoute(req, ports);
      if (userGroups) return userGroups;

      const diagnostics = await handleDiagnosticsRoute(req, ports);
      if (diagnostics) return diagnostics;

      const maintenance = await handleMaintenanceRoute(req, ports);
      if (maintenance) return maintenance;

      const coreCrm = await handleCoreCrmReadRoute(req, ports);
      if (coreCrm) return coreCrm;

      const dashboard = await handleDashboardRoute(req, ports);
      if (dashboard) return dashboard;

      const extendedCrm = await handleExtendedCrmReadRoute(req, ports);
      if (extendedCrm) return extendedCrm;

      const followUp = await handleFollowUpRoute(req, ports);
      if (followUp) return followUp;

      const settings = await handleSettingsRoute(req, ports);
      if (settings) return settings;

      const mail = await handleMailReadRoute(req, ports);
      if (mail) return mail;

      const notices = await handleNoticeRoute(req, ports);
      if (notices) return notices;

      const workflow = await handleWorkflowReadRoute(req, ports);
      if (workflow) return workflow;

      const pgp = await handlePgpReadRoute(req, ports);
      if (pgp) return pgp;

      const spam = await handleSpamReadRoute(req, ports);
      if (spam) return spam;

      const returns = await handleReturnsRoute(req, ports);
      if (returns) return returns;

      const locks = await handleLockRoute(req, ports);
      if (locks) return locks;

      return error(404, 'not_found', 'Route nicht gefunden');
    },
  };
}
