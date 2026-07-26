import type { MailResource } from '@simplecrm/core';

import type { ApiResponse, AuthenticatedPrincipal, ServerApiPorts } from '../api/types';
import { error } from '../api/http';
import { MailAccessDeniedError } from './service';

export async function rejectUnlessWorkflowMessageReadable(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  messageId: number,
): Promise<ApiResponse | null> {
  if (!ports.mailAccess || !ports.mailResourceLookup) {
    return error(503, 'mail_access_unavailable', 'Mail-Zugriffskontrolle nicht konfiguriert');
  }

  if (ports.emailMessages) {
    const message = await ports.emailMessages.get({
      workspaceId: principal.workspaceId,
      id: messageId,
      includeBody: false,
    });
    if (!message) {
      return error(404, 'email_message_not_found', 'Email message nicht gefunden');
    }
  }

  const resources = await ports.mailResourceLookup.resolve({
    workspaceId: principal.workspaceId,
    target: { kind: 'message', id: messageId },
  });
  if (resources.length === 0) {
    return error(404, 'email_message_not_found', 'Email message nicht gefunden');
  }

  const actor = {
    workspaceId: principal.workspaceId,
    userId: principal.userId,
    isOwner: principal.role === 'owner',
    isAdmin: principal.role === 'admin',
  };

  try {
    await assertMessageReadable(ports, principal.workspaceId, actor, resources[0]!);
  } catch (error) {
    if (error instanceof MailAccessDeniedError) {
      return error(403, 'forbidden', error.message);
    }
    throw error;
  }

  return null;
}

async function assertMessageReadable(
  ports: ServerApiPorts,
  workspaceId: string,
  actor: {
    workspaceId: string;
    userId: string;
    isOwner: boolean;
    isAdmin: boolean;
  },
  resource: MailResource,
): Promise<void> {
  await ports.mailAccess!.assertPermission({
    workspaceId,
    actor,
    permission: 'mail.metadata.read',
    resource,
  });
}
