export type JobPayload = Record<string, unknown>;

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
