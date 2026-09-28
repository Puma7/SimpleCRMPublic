/**
 * Plan 043: IMAP-Knoten (verschieben, auf dem Server löschen).
 * Reine Verschiebung aus workflow-execution.ts; Verhalten unverändert.
 */
import type { WorkspaceTransaction } from '../db/workspace-context';
import {
  applyWorkflowImapMoveLocalState,
  runWorkflowImapMoveAction,
  softDeleteWorkflowMessage,
  unsupportedWorkflowNodeResult,
} from './shared';
import type {
  NodeResult,
  ServerNodeHandler,
  ServerNodeHandlerArgs,
  ServerWorkflowContext,
  ServerWorkflowRuntimePorts,
} from './types';

/** Knoten email.move_imap. */
async function handleEmailMoveImap({ trx, context, config, log, now, ports }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  return await moveWorkflowMessageOnImap(trx, context, config, now, ports, log);
}

/** Knoten email.delete_server. */
async function handleEmailDeleteServer({ trx, context, log, now, ports }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  return await deleteWorkflowMessageOnImap(trx, context, now, ports, log);
}

async function moveWorkflowMessageOnImap(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  config: Record<string, unknown>,
  now: Date,
  ports: ServerWorkflowRuntimePorts,
  log: string[],
): Promise<NodeResult> {
  const targetFolderPath = String(
    config.folderPath ?? config.folder ?? config.targetFolderPath ?? 'Spam',
  ).trim();
  if (!targetFolderPath) return { status: 'skipped', port: 'default', message: 'Zielordner leer' };

  const moveResult = await runWorkflowImapMoveAction(context, targetFolderPath, ports, log, 'email.move_imap', now);
  if (!moveResult.ok) return moveResult.node;

  if (!ports.deferredImapEffects) {
    const localResult = await applyWorkflowImapMoveLocalState(trx, context, targetFolderPath, now);
    if (localResult) return localResult;
  }

  return {
    status: 'ok',
    port: 'default',
    variables: {
      ...(moveResult.value.sourceFolderPath
        ? { 'imap.source_folder': moveResult.value.sourceFolderPath }
        : {}),
      'imap.moved_to': moveResult.value.targetFolderPath ?? targetFolderPath,
      'message.id': context.messageId,
    },
  };
}

async function deleteWorkflowMessageOnImap(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  now: Date,
  ports: ServerWorkflowRuntimePorts,
  log: string[],
): Promise<NodeResult> {
  if (context.messageId === null) {
    return { status: 'error', port: 'error', message: 'Keine Nachricht im Kontext' };
  }
  if (!ports.workflowImapActions) {
    return unsupportedWorkflowNodeResult('email.delete_server', log);
  }
  if (ports.deferredImapEffects) {
    ports.deferredImapEffects.push({
      kind: 'delete',
      workspaceId: context.workspaceId,
      messageId: context.messageId,
      context,
      now,
    });
    return {
      status: 'ok',
      port: 'default',
      variables: {
        'imap.deleted': true,
        'message.id': context.messageId,
      },
    };
  }

  const deleted = await ports.workflowImapActions.delete({
    workspaceId: context.workspaceId,
    messageId: context.messageId,
  });
  if (!deleted.ok) return { status: 'error', port: 'error', message: deleted.error };

  const localResult = await softDeleteWorkflowMessage(trx, context, now);
  if (localResult) return localResult;

  return {
    status: 'ok',
    port: 'default',
    variables: {
      'imap.source_folder': deleted.sourceFolderPath,
      'imap.deleted': true,
      'message.id': context.messageId,
    },
  };
}

/** Knoten dieser Kategorie nach dem Dry-Run-Schutz. */
export const IMAP_NODE_HANDLERS: Readonly<Record<string, ServerNodeHandler>> = {
  'email.move_imap': handleEmailMoveImap,
  'email.delete_server': handleEmailDeleteServer,
};
