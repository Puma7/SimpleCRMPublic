import type { WorkspaceTransaction } from '../db/workspace-context';
import type { MailAclRolloutEvaluationContext } from './types';

const postgresTransaction = Symbol('mail-acl-rollout-postgres-transaction');

type PostgresMailAclRolloutEvaluationContext = MailAclRolloutEvaluationContext & Readonly<{
  [postgresTransaction]: WorkspaceTransaction;
}>;

export function createPostgresMailAclRolloutEvaluationContext(
  workspaceId: string,
  trx: WorkspaceTransaction,
): MailAclRolloutEvaluationContext {
  const context: PostgresMailAclRolloutEvaluationContext = {
    workspaceId,
    [postgresTransaction]: trx,
  };
  return context;
}

export function requirePostgresMailAclRolloutTransaction(
  context: MailAclRolloutEvaluationContext,
  workspaceId: string,
): WorkspaceTransaction {
  if (context.workspaceId !== workspaceId) {
    throw new Error('mail ACL rollout evaluation context workspace mismatch');
  }
  const trx = (context as Partial<PostgresMailAclRolloutEvaluationContext>)[postgresTransaction];
  if (!trx) throw new Error('mail ACL rollout evaluation context is not PostgreSQL-backed');
  return trx;
}
