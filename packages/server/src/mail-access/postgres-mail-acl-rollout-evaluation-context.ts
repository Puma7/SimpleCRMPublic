import type { WorkspaceTransaction } from '../db/workspace-context';
import type { MailAclRolloutEvaluationContext, MailAclRolloutState } from './types';

const postgresTransaction = Symbol('mail-acl-rollout-postgres-transaction');
const rolloutState = Symbol('mail-acl-rollout-state');

type PostgresMailAclRolloutEvaluationContext = MailAclRolloutEvaluationContext & Readonly<{
  [postgresTransaction]: WorkspaceTransaction;
  [rolloutState]: MailAclRolloutState;
}>;

export function createPostgresMailAclRolloutEvaluationContext(
  workspaceId: string,
  trx: WorkspaceTransaction,
  state: MailAclRolloutState,
): MailAclRolloutEvaluationContext {
  const context: PostgresMailAclRolloutEvaluationContext = {
    workspaceId,
    [postgresTransaction]: trx,
    [rolloutState]: state,
  };
  return context;
}

export function requirePostgresMailAclRolloutState(
  context: MailAclRolloutEvaluationContext,
  workspaceId: string,
): MailAclRolloutState {
  if (context.workspaceId !== workspaceId) {
    throw new Error('mail ACL rollout evaluation context workspace mismatch');
  }
  const state = (context as Partial<PostgresMailAclRolloutEvaluationContext>)[rolloutState];
  if (!state) throw new Error('mail ACL rollout evaluation context is not PostgreSQL-backed');
  return state;
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
