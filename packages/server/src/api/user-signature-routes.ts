import type {
  ApiRequest,
  ApiResponse,
  CanonicalApiRoute,
  CanonicalApiRouteRegistration,
  ServerApiPorts,
} from './types';
import {
  data,
  error,
  getStringField,
  positiveIntFromPath,
  requirePrincipal,
} from './http';

type UserSignatureRouteKind = 'list' | 'upsert';

type UserSignatureRouteRegistration = Readonly<{
  kind: UserSignatureRouteKind;
  registration: CanonicalApiRouteRegistration;
}>;

export const USER_SIGNATURE_ROUTE_REGISTRATIONS: readonly UserSignatureRouteRegistration[] = Object.freeze([
  {
    kind: 'list',
    registration: {
      methods: ['GET'],
      path: '/api/v1/email/user-signatures',
      pattern: /^\/api\/v1\/email\/user-signatures$/,
    },
  },
  {
    kind: 'upsert',
    registration: {
      methods: ['POST'],
      path: '/api/v1/email/user-signatures/by-account/:accountId/upsert',
      pattern: /^\/api\/v1\/email\/user-signatures\/by-account\/([^/]+)\/upsert$/,
    },
  },
]);

export const USER_SIGNATURE_ROUTE_INVENTORY: readonly CanonicalApiRoute[] = Object.freeze(
  USER_SIGNATURE_ROUTE_REGISTRATIONS.flatMap(({ registration }) => registration.methods.map((method) => ({
    source: 'user-signature-routes',
    method,
    path: registration.path,
    pattern: registration.pattern,
  }))),
);

// Self-service per-user, per-account signatures. Every authenticated user
// manages only their own rows (scoped by principal.userId), so no admin gate.
export async function handleUserSignatureRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse | null> {
  if (!req.path.startsWith('/api/v1/email/user-signatures')) return null;

  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.emailUserSignatures) {
    return error(503, 'email_user_signatures_unavailable', 'Nutzer-Signatur-API nicht konfiguriert');
  }

  const matchedRoute = USER_SIGNATURE_ROUTE_REGISTRATIONS.find(({ registration }) => (
    registration.pattern.test(req.path)
  ));
  if (matchedRoute?.kind === 'list') {
    if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
    const result = await ports.emailUserSignatures.listForUser({
      workspaceId: principal.workspaceId,
      userId: principal.userId,
    });
    return data(200, result);
  }

  if (matchedRoute?.kind === 'upsert') {
    if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
    const upsertMatch = matchedRoute.registration.pattern.exec(req.path);
    const accountId = positiveIntFromPath(upsertMatch?.[1]);
    if (accountId === null) return error(400, 'invalid_account_id', 'account id muss eine positive Ganzzahl sein');
    // null/absent clears the signature; a string saves it.
    const signatureHtml = getStringField(req.body, 'signatureHtml');
    if (signatureHtml !== null && signatureHtml.length > 20_000) {
      return error(400, 'validation_error', 'signatureHtml darf maximal 20000 Zeichen haben');
    }
    const result = await ports.emailUserSignatures.upsert({
      workspaceId: principal.workspaceId,
      userId: principal.userId,
      accountId,
      signatureHtml,
    });
    if (!result.ok) return error(404, 'email_account_not_found', 'Konto nicht gefunden');
    return data(200, { success: true });
  }

  return null;
}
