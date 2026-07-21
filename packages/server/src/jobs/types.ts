import type { MailSqlScope } from '../mail-access/types';

export type JobPayload = Record<string, unknown>;

export type MailJobAuthorization =
  | Readonly<{
    kind: 'workflow_execute_delayed_message';
    delayedJobId: number;
    messageId: number | null;
  }>
  // The initiating user's mail.draft.create scope for a compose-originated
  // ai.pick_canned, so the worker restricts the canned-template query (which runs
  // under the system role) to global + in-scope responses instead of every
  // workspace template. Absent for service/automatic runs (no per-user scope).
  | Readonly<{
    kind: 'ai_pick_canned_scope';
    cannedScope: MailSqlScope;
  }>;

export type QueuedJob = Readonly<{
  id: number;
  type: string;
  payload: JobPayload;
  runAfter: string;
  attempts: number;
  maxAttempts: number;
  lockedAt: string | null;
  lockedBy: string | null;
  lastError: string | null;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
  mailAuthorization?: MailJobAuthorization;
}>;

export type EnqueueJobInput = Readonly<{
  type: string;
  payload: JobPayload;
  workspaceId: string;
  runAfter?: Date;
  maxAttempts?: number;
}>;

export type ClaimJobInput = Readonly<{
  workerId: string;
  now?: Date;
}>;

export type FailJobInput = Readonly<{
  job: QueuedJob;
  error: unknown;
  now?: Date;
}>;

export type JobQueuePort = Readonly<{
  enqueue(input: EnqueueJobInput): Promise<QueuedJob>;
  clearScheduledSendJob?(input: {
    workspaceId: string;
    draftId: number;
  }): Promise<void>;
  claimNext(input: ClaimJobInput): Promise<QueuedJob | null>;
  complete(job: QueuedJob): Promise<boolean>;
  fail(input: FailJobInput): Promise<QueuedJob | null>;
  failTerminal(input: FailJobInput): Promise<QueuedJob | null>;
  releaseStaleLocks(input: {
    staleBefore: Date;
    limit?: number;
  }): Promise<readonly QueuedJob[]>;
  releaseAccountSyncLocks?(input: {
    workspaceId: string;
    accountId: number;
    staleBefore: Date;
    limit?: number;
  }): Promise<readonly QueuedJob[]>;
}>;
