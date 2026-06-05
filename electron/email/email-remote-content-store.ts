import type { RemoteContentPolicy } from '../../shared/email-html-remote-images';
import { getDb } from '../sqlite-service';
import {
  consumeAllowedOnceRemoteContent,
  type EffectiveRemotePolicy,
  setRemoteContentPolicy,
} from './email-remote-content';

function getEmailDbOrThrow() {
  const db = getDb();
  if (!db) throw new Error('Database not initialized');
  return db;
}

export function consumeAllowedOnceRemoteContentLocal(messageId: number): EffectiveRemotePolicy {
  return consumeAllowedOnceRemoteContent(getEmailDbOrThrow(), messageId);
}

export function setLocalRemoteContentPolicy(
  messageId: number,
  policy: RemoteContentPolicy,
  remember?: { scope: 'sender' | 'domain'; value: string },
): void {
  setRemoteContentPolicy(getEmailDbOrThrow(), messageId, policy, remember);
}
