/**
 * IPC für Learnings (TA-P5). Verwaltung (Einstellungen, Einträge, Vorschläge)
 * nur Owner/Admin — Server-Parität workflows.manage. „Learning notieren“
 * darf jeder, der die Mail lesen darf (accountAccess 'ro' über die messageId;
 * ohne Mail-Bezug genügt die Anmeldung).
 */
import type { IpcMainInvokeEvent } from 'electron';
import { IPCChannels } from '../../shared/ipc/channels';
import type {
  AiLearningsRunDigestPayload,
  AiLearningsSettingsDto,
  LearningCandidateKind,
} from '../../shared/ai-learnings';
import { requireAuthSession } from '../auth/current-user';
import { registerIpcHandler } from './register';
import {
  acceptAiLearningDigest,
  addAiLearningNote,
  deleteAiLearningCandidate,
  getAiLearningDigest,
  getAiLearningsOverview,
  listAiLearningCandidates,
  listAiLearningDigests,
  rejectAiLearningDigest,
  runAiLearningsDigest,
  saveAiLearningsSettings,
} from '../email/email-ai-learnings';

type Disposer = () => void;

const MANAGER_ROLES: ['owner', 'admin'] = ['owner', 'admin'];

export function registerAiLearningsHandlers(options: {
  logger: Pick<typeof console, 'debug' | 'info' | 'warn' | 'error'>;
}): Disposer {
  const { logger } = options;
  const manage = { logger, requireRole: MANAGER_ROLES, accountAccess: 'rw' as const };
  const disposers: Disposer[] = [];

  disposers.push(registerIpcHandler(IPCChannels.Email.GetLearningsOverview, async () => getAiLearningsOverview(), manage));

  disposers.push(registerIpcHandler(
    IPCChannels.Email.SaveLearningsSettings,
    async (_event: IpcMainInvokeEvent, payload: Partial<AiLearningsSettingsDto>) => saveAiLearningsSettings(payload),
    manage,
  ));

  disposers.push(registerIpcHandler(
    IPCChannels.Email.ListLearningCandidates,
    async (_event: IpcMainInvokeEvent, payload?: { kind?: LearningCandidateKind; limit?: number }) =>
      listAiLearningCandidates(payload ?? {}),
    manage,
  ));

  disposers.push(registerIpcHandler(
    IPCChannels.Email.DeleteLearningCandidate,
    async (_event: IpcMainInvokeEvent, payload: { id: number }) => {
      const deleted = deleteAiLearningCandidate(payload.id);
      return deleted ? { success: true as const } : { success: false as const, error: 'Eintrag nicht gefunden' };
    },
    manage,
  ));

  disposers.push(registerIpcHandler(
    IPCChannels.Email.RunLearningsDigest,
    async (event: IpcMainInvokeEvent, payload?: AiLearningsRunDigestPayload) => {
      const session = requireAuthSession(event);
      return runAiLearningsDigest({
        ...(payload?.period ? { period: payload.period } : {}),
        knowledgeBaseId: payload?.knowledgeBaseId ?? null,
        profileId: payload?.profileId ?? null,
        // Auf Knopfdruck genügt ein Eintrag; der Workflow-Baustein nutzt seine Mindestanzahl.
        minCandidates: payload?.minCandidates ?? 1,
        trigger: 'manual',
        actorUserId: session.userId,
      });
    },
    manage,
  ));

  disposers.push(registerIpcHandler(
    IPCChannels.Email.ListLearningDigests,
    async (_event: IpcMainInvokeEvent, payload?: { limit?: number }) => listAiLearningDigests(payload ?? {}),
    manage,
  ));

  disposers.push(registerIpcHandler(
    IPCChannels.Email.GetLearningDigest,
    async (_event: IpcMainInvokeEvent, payload: { id: number }) => getAiLearningDigest(payload.id),
    manage,
  ));

  disposers.push(registerIpcHandler(
    IPCChannels.Email.AcceptLearningDigest,
    async (event: IpcMainInvokeEvent, payload: { id: number; content: string; confirmOverwrite?: boolean }) => {
      const session = requireAuthSession(event);
      return acceptAiLearningDigest({ ...payload, actorUserId: session.userId });
    },
    manage,
  ));

  disposers.push(registerIpcHandler(
    IPCChannels.Email.RejectLearningDigest,
    async (event: IpcMainInvokeEvent, payload: { id: number }) => {
      const session = requireAuthSession(event);
      return rejectAiLearningDigest({ id: payload.id, actorUserId: session.userId });
    },
    manage,
  ));

  disposers.push(registerIpcHandler(
    IPCChannels.Email.AddLearningNote,
    async (event: IpcMainInvokeEvent, payload: { text: string; messageId?: number | null }) => {
      const session = requireAuthSession(event);
      return addAiLearningNote({
        text: payload.text,
        messageId: payload.messageId ?? null,
        actorUserId: session.userId,
      });
    },
    { logger, accountAccess: 'ro' },
  ));

  return () => disposers.forEach((dispose) => dispose());
}
