import { getSyncInfo } from '../sqlite-service';

/** Global spam score threshold from Einstellungen → Automatisierung (1–100). */
export function getWorkflowSpamScoreThreshold(): number {
  const raw = getSyncInfo('workflow_spam_score_threshold');
  const n = Number(raw);
  if (!Number.isFinite(n)) return 70;
  return Math.max(1, Math.min(100, Math.floor(n)));
}
