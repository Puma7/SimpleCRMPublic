import { handleAuthRoute } from './auth-routes';
import { handleAuthSecurityRoute } from './auth-security-routes';
import { handleAutomationReadRoute } from './automation-routes';
import { handleCoreCrmReadRoute } from './core-crm-routes';
import { handleCustomerRoute } from './customer-routes';
import { handleDashboardRoute } from './dashboard-routes';
import { handleDiagnosticsRoute } from './diagnostics-routes';
import { handleExtendedCrmReadRoute } from './extended-crm-routes';
import { handleFollowUpRoute } from './follow-up-routes';
import {
  EMAIL_TRACKING_ROUTE_INVENTORY,
  handleEmailTrackingRoute,
  handlePublicEmailTrackingRoute,
} from './email-tracking-routes';
import { handleSmtpRelayRoute, SMTP_RELAY_ROUTE_INVENTORY } from './relay-routes';
import { handleLockRoute, MAIL_LOCK_ROUTE_INVENTORY } from './lock-routes';
import { handleMailDelegationRoute } from './mail-delegation-routes';
import { handleMailAclRolloutRoute } from './mail-acl-rollout-routes';
import { handleMailReadRoute, MAIL_ROUTE_INVENTORY } from './mail-routes';
import { handleMaintenanceRoute } from './maintenance-routes';
import { handleNoticeRoute, MAIL_NOTICE_ROUTE_INVENTORY } from './notice-routes';
import { handlePgpReadRoute, PGP_MAIL_ROUTE_INVENTORY } from './pgp-routes';
import { handlePublicPortalRoute, handleReturnsRoute } from './returns-routes';
import { handleSpamReadRoute, SPAM_MAIL_ROUTE_INVENTORY } from './spam-routes';
import { handleSettingsRoute, MAIL_SETTINGS_ROUTE_INVENTORY } from './settings-routes';
import { handleUserGroupRoute } from './user-group-routes';
import { handleUserSignatureRoute, USER_SIGNATURE_ROUTE_INVENTORY } from './user-signature-routes';
import { handleWorkflowReadRoute, WORKFLOW_MAIL_ROUTE_INVENTORY } from './workflow-routes';
import { getServerOpenApiSpec } from './openapi';
import type { ApiRequest, ApiResponse, CanonicalApiRoute, ServerApiPorts } from './types';
import { data, error } from './http';

export type ServerApi = {
  handle(req: ApiRequest): Promise<ApiResponse>;
};

type ServerApiRouteHandler = (
  req: ApiRequest,
  ports: ServerApiPorts,
) => Promise<ApiResponse | null>;

export type ServerApiRouteRegistration = Readonly<{
  source: string;
  handler: ServerApiRouteHandler;
}> & (
  | Readonly<{ kind: 'mail'; routes: readonly CanonicalApiRoute[] }>
  | Readonly<{ kind: 'non_mail' }>
);

const nonMailRoutes = (source: string, handler: ServerApiRouteHandler): ServerApiRouteRegistration => ({
  kind: 'non_mail',
  source,
  handler,
});

const mailRoutes = (
  source: string,
  routes: readonly CanonicalApiRoute[],
  handler: ServerApiRouteHandler,
): ServerApiRouteRegistration => ({ kind: 'mail', source, routes, handler });

export const SERVER_API_ROUTE_REGISTRATIONS: readonly ServerApiRouteRegistration[] = Object.freeze([
  nonMailRoutes('auth-security-routes', handleAuthSecurityRoute),
  nonMailRoutes('auth-routes', handleAuthRoute),
  nonMailRoutes('automation-routes', handleAutomationReadRoute),
  mailRoutes('email-tracking-routes', EMAIL_TRACKING_ROUTE_INVENTORY, handleEmailTrackingRoute),
  // Relays and user signatures share /api/v1/email with the generic mail routes.
  mailRoutes('relay-routes', SMTP_RELAY_ROUTE_INVENTORY, handleSmtpRelayRoute),
  mailRoutes('user-signature-routes', USER_SIGNATURE_ROUTE_INVENTORY, handleUserSignatureRoute),
  nonMailRoutes('customer-routes', handleCustomerRoute),
  nonMailRoutes('user-group-routes', handleUserGroupRoute),
  nonMailRoutes('mail-delegation-routes', handleMailDelegationRoute),
  nonMailRoutes('mail-acl-rollout-routes', handleMailAclRolloutRoute),
  nonMailRoutes('diagnostics-routes', handleDiagnosticsRoute),
  nonMailRoutes('maintenance-routes', handleMaintenanceRoute),
  nonMailRoutes('core-crm-routes', handleCoreCrmReadRoute),
  nonMailRoutes('dashboard-routes', handleDashboardRoute),
  nonMailRoutes('extended-crm-routes', handleExtendedCrmReadRoute),
  nonMailRoutes('follow-up-routes', handleFollowUpRoute),
  mailRoutes('settings-routes', MAIL_SETTINGS_ROUTE_INVENTORY, handleSettingsRoute),
  mailRoutes('mail-routes', MAIL_ROUTE_INVENTORY, handleMailReadRoute),
  mailRoutes('notice-routes', MAIL_NOTICE_ROUTE_INVENTORY, handleNoticeRoute),
  mailRoutes('workflow-mail-routes', WORKFLOW_MAIL_ROUTE_INVENTORY, handleWorkflowReadRoute),
  nonMailRoutes('workflow-routes', handleWorkflowReadRoute),
  mailRoutes('pgp-routes', PGP_MAIL_ROUTE_INVENTORY, handlePgpReadRoute),
  mailRoutes('spam-routes', SPAM_MAIL_ROUTE_INVENTORY, handleSpamReadRoute),
  nonMailRoutes('returns-routes', handleReturnsRoute),
  mailRoutes('lock-routes', MAIL_LOCK_ROUTE_INVENTORY, handleLockRoute),
]);

export const SERVER_MAIL_ROUTE_INVENTORY: readonly CanonicalApiRoute[] = Object.freeze(
  SERVER_API_ROUTE_REGISTRATIONS.flatMap((registration) => (
    registration.kind === 'mail' ? registration.routes : []
  )),
);

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
      const publicEmailTracking = await handlePublicEmailTrackingRoute(req, ports);
      if (publicEmailTracking) return publicEmailTracking;

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

      for (const registration of SERVER_API_ROUTE_REGISTRATIONS) {
        let requestPorts = ports;
        if (
          registration.kind === 'mail'
          && registration.routes.some((route) => route.method === req.method && route.pattern.test(req.path))
        ) {
          const {
            enforceMailHttpPolicy,
            portsWithMailAccessContext,
          } = await import('../mail-access/http-policy-enforcer.js');
          const enforcement = await enforceMailHttpPolicy(req, ports);
          if (!enforcement.ok) return enforcement.response;
          requestPorts = portsWithMailAccessContext(ports, enforcement.context);
        }
        const response = await registration.handler(req, requestPorts);
        if (response) return response;
      }

      return error(404, 'not_found', 'Route nicht gefunden');
    },
  };
}
