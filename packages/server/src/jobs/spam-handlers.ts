import type { Kysely } from 'kysely';

import type { EmailMessageApiPort, ServerJobQueueApiPort } from '../api';
import { enqueueInboundWorkflowsAfterSpam } from '../mail-inbound-workflow-enqueue';
import type { ServerDatabase } from '../db';
import type { WorkspaceSessionApplier } from '../db/workspace-context';
import type { JobPayload } from './types';
import type { JobHandlerRegistry } from './worker';

export type SpamScoringJobHandlersOptions = Readonly<{
  emailMessages?: EmailMessageApiPort;
  jobQueue?: ServerJobQueueApiPort;
  db?: Kysely<ServerDatabase>;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}>;

export type SpamScoringPlan = Readonly<{
  workspaceId: string;
  messageId: number;
  applyStatus: boolean;
  runSecurityCheck: boolean;
  enqueueInboundWorkflows: boolean;
  actorUserId?: string;
}>;

export function createSpamScoringJobHandlers(options: SpamScoringJobHandlersOptions): JobHandlerRegistry {
  return {
    'mail.spam.score': async (job) => {
      if (!options.emailMessages?.evaluateSpamDecision && !options.emailMessages?.runSecurityCheck) {
        throw new Error('email message spam decision API is not configured');
      }
      const plan = buildSpamScoringPlan(job.payload, job.workspaceId);
      const input = {
        workspaceId: plan.workspaceId,
        ...(plan.actorUserId ? { actorUserId: plan.actorUserId } : {}),
        messageId: plan.messageId,
        values: { applyStatus: plan.applyStatus },
      };
      const result = plan.runSecurityCheck && options.emailMessages.runSecurityCheck
        ? await options.emailMessages.runSecurityCheck(input)
        : await options.emailMessages.evaluateSpamDecision?.(input);
      if (!result) throw new Error(`email message not found for spam scoring: ${plan.messageId}`);

      if (
        plan.enqueueInboundWorkflows
        && options.jobQueue
        && options.db
      ) {
        await enqueueInboundWorkflowsAfterSpam(
          {
            db: options.db,
            jobQueue: options.jobQueue,
            ...(options.applyWorkspaceSession ? { applyWorkspaceSession: options.applyWorkspaceSession } : {}),
          },
          {
            workspaceId: plan.workspaceId,
            messageId: plan.messageId,
            ...(plan.actorUserId ? { actorUserId: plan.actorUserId } : {}),
          },
        );
      }
    },
  };
}

export function buildSpamScoringPlan(payload: JobPayload, jobWorkspaceId: string): SpamScoringPlan {
  const workspaceId = requiredString(payload, 'workspaceId');
  if (workspaceId !== jobWorkspaceId) {
    throw new Error('workspaceId must match the queued job workspace');
  }
  return {
    workspaceId,
    messageId: requiredPositiveInteger(payload, 'messageId'),
    applyStatus: optionalBoolean(payload, 'applyStatus', false),
    runSecurityCheck: optionalBoolean(payload, 'runSecurityCheck', false),
    enqueueInboundWorkflows: optionalBoolean(payload, 'enqueueInboundWorkflows', false),
    ...optionalString(payload, 'actorUserId'),
  };
}

function requiredString(payload: JobPayload, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

function optionalString(payload: JobPayload, key: string): { actorUserId?: string } {
  const value = payload[key];
  if (value === undefined || value === null || value === '') return {};
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return { actorUserId: value.trim() };
}

function requiredPositiveInteger(payload: JobPayload, key: string): number {
  const value = payload[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return value;
}

function optionalBoolean(payload: JobPayload, key: string, fallback: boolean): boolean {
  const value = payload[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') throw new Error(`${key} must be a boolean`);
  return value;
}
