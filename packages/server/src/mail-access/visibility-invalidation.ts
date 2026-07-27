import type { ServerEventPort } from '../api/types';

/**
 * Die Sichtbarkeits-Invalidierung nach einem committeten Schreibvorgang —
 * gemeinsam fuer den Workflow-Lauf und die KI-Klassifizierung.
 *
 * Beide schreiben Tags bzw. Kategorien, die in Sichtbarkeitsfiltern vorkommen
 * koennen, und beide muessen danach jedem betroffenen Nutzer ein
 * `email_acl.changed` schicken. Die Schleife stand zweimal wortgleich da; hier
 * steht sie einmal, samt der Begruendung des `reason`-Feldes.
 */

/**
 * Wie viele Ereignisse gleichzeitig geschrieben werden.
 *
 * Sequenziell kostete ein haeufiger Tag hinter einem GRUPPEN-Binding einen
 * eigenen Roundtrip je Nutzer — der produktive Postgres-Ereignisport oeffnet
 * pro publish eine eigene Workspace-Transaktion. Bei grossen Gruppen staut das
 * den Workflow-Worker und damit die eingehende Mailverarbeitung auf, und zwar
 * bei JEDER automatisch verarbeiteten Nachricht.
 *
 * Begrenzt, nicht unbegrenzt: die Ereignisse sind Nebenwirkung eines bereits
 * committeten Laufs, sie duerfen den Verbindungspool nicht leerraeumen, den die
 * eigentliche Verarbeitung braucht.
 */
export const MAIL_VISIBILITY_INVALIDATION_CONCURRENCY = 8;

export async function publishMailVisibilityInvalidation(input: Readonly<{
  workspaceId: string;
  /** Der Worker laeuft ohne menschlichen Akteur; 'system' ist die uebliche Kennzeichnung. */
  actorUserId?: string;
  targetUserIds: Iterable<string>;
  events: Pick<ServerEventPort, 'publish'>;
  /** Praefix der Warnung, damit die Herkunft im Log erkennbar bleibt. */
  logPrefix: string;
}>): Promise<void> {
  const targets = [...new Set(input.targetUserIds)];
  if (targets.length === 0) return;

  const occurredAt = new Date().toISOString();
  const actorUserId = input.actorUserId ?? 'system';
  let cursor = 0;
  const publishNext = async (): Promise<void> => {
    for (let index = cursor++; index < targets.length; index = cursor++) {
      const targetUserId = targets[index]!;
      try {
        await input.events.publish({
          type: 'email_acl.changed',
          workspaceId: input.workspaceId,
          entityType: 'email_acl',
          entityId: targetUserId,
          actorUserId,
          occurredAt,
          // `reason` unterscheidet die reine SICHTBARKEITS-Auffrischung von einer
          // echten ACL-Mutation. Ohne sie behandelt der AuthProvider jedes
          // selbstadressierte email_acl.changed als moeglichen Rollenwechsel und
          // erneuert die Sitzung mit force — inklusive Token-Rotation und
          // Audit-Eintrag; die Konten- und Teamliste wuerde ebenfalls neu
          // geladen. Ein Tagging-Workflow laeuft auf jeder eingehenden
          // Nachricht; das waere Dauerlast fuer jeden verbundenen Betroffenen,
          // obwohl sich nur die Sichtbarkeit einzelner Nachrichten geaendert hat.
          payload: { targetUserId, state: 'changed', reason: 'visibility_filter' },
        });
      } catch (error) {
        // Best effort je Empfaenger: der Schreibvorgang ist committed, ein
        // fehlgeschlagenes Publish darf ihn nicht nachtraeglich scheitern
        // lassen UND nicht die uebrigen Empfaenger mitreissen. Der Client heilt
        // beim naechsten Ereignis oder Reload.
        console.warn(
          `${input.logPrefix} email_acl.changed publish failed for user ${targetUserId}; write already committed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  };

  await Promise.all(Array.from(
    { length: Math.min(MAIL_VISIBILITY_INVALIDATION_CONCURRENCY, targets.length) },
    publishNext,
  ));
}
