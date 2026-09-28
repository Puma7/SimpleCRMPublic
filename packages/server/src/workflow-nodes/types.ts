/**
 * Plan 043: gemeinsame Typen der Server-Workflow-Ausführung (Engine und Knoten).
 * Reine Verschiebung aus workflow-execution.ts; Verhalten unverändert.
 */
import type {
  WorkflowDirection,
  WorkflowGraphDocument,
  WorkflowGraphNode,
  WorkflowRunDetailState,
  WorkflowTriggerKind,
} from '@simplecrm/core';
import type { Selectable } from 'kysely';
import type { AiReviewPreviewRunner } from '../ai-classification';
import type { EmailMessagesTable, EmailWorkflowsTable } from '../db';
import type { WorkspaceTransaction } from '../db/workspace-context';
import type { MssqlSettingsPort } from '../mssql-settings';
import type { WorkflowAiDecideDeps } from '../workflow-ai-decide';
import type { WorkflowAiDraftNodeDeps } from '../workflow-ai-draft-nodes';
import type { ServerWorkflowImapActionPort } from '../workflow-imap-actions';
import type { InboundWorkflowChainContext } from '../workflow-inbound-chain-context';

export type WorkflowRow = Pick<
  Selectable<EmailWorkflowsTable>,
  | 'id'
  | 'source_sqlite_id'
  | 'account_id'
  | 'trigger_name'
  | 'enabled'
  | 'definition_json'
  | 'graph_json'
  | 'execution_mode'
  | 'schedule_account_id'
>;

export type MessageRow = Pick<
  Selectable<EmailMessagesTable>,
  | 'id'
  | 'source_sqlite_id'
  | 'account_id'
  | 'subject'
  | 'from_json'
  | 'to_json'
  | 'cc_json'
  | 'snippet'
  | 'body_text'
  | 'body_html'
  | 'has_attachments'
  | 'attachments_json'
  | 'customer_id'
  | 'customer_source_sqlite_id'
  | 'auth_spf'
  | 'auth_dkim'
  | 'auth_dmarc'
  | 'auth_arc'
  | 'rspamd_score'
  | 'rspamd_action'
  | 'is_spam'
  | 'spam_status'
  | 'spam_score'
  | 'spam_score_label'
  | 'spam_decision_source'
  | 'spam_score_breakdown_json'
  | 'raw_headers'
  | 'reply_parent_message_id'
>;

export type WorkflowStepStatus = 'ok' | 'error' | 'skipped';

export type WorkflowMessagePatch = {
  archived?: boolean;
  assigned_to?: string | null;
  assigned_to_user_id?: string | null;
  done_local?: boolean;
  folder_kind?: string;
  is_spam?: boolean;
  seen_local?: boolean;
  soft_deleted?: boolean;
  spam_decided_at?: Date;
  spam_status?: string;
  trash_prev_archived?: boolean | null;
  trash_prev_folder_kind?: string | null;
  trash_prev_is_spam?: boolean | null;
  updated_at?: Date;
};

export type WorkflowStringContext = Record<string, string>;

export type WorkflowVariableContext = Record<string, string | number | boolean | null>;

export type ServerWorkflowContext = {
  workspaceId: string;
  workflowId: number;
  workflowSourceSqliteId: number;
  runId: number;
  runSourceSqliteId: number;
  messageId: number | null;
  messageSourceSqliteId: number | null;
  trigger: WorkflowTriggerKind;
  direction: WorkflowDirection;
  message: MessageRow | null;
  strings: WorkflowStringContext;
  variables: WorkflowVariableContext;
  actorUserId?: string;
  trustedService?: boolean;
  manualAdminExecute?: boolean;
  previewOutbound?: boolean;
  /**
   * Testlauf mit „KI wirklich fragen“ (Plan 047): ai.decide fragt das Modell
   * wie die Versandvorschau synchron. Nur im gespeicherten Testlauf gesetzt.
   */
  testRealAi?: boolean;
  /** Priority-chain fields: must survive AI/HTTP/delay continuations. */
  inboundWorkflowChain?: InboundWorkflowChainContext;
  skipIfMessageSpamOrReview?: boolean;
  /**
   * Welcher Trigger-Zweig laeuft gerade? Genau die Einheit, die die
   * Join-Barriere zaehlt (ein Zaehler pro Trigger-Kante).
   */
  branchKey?: string;
  /** Lauf, der den Trigger-Fan-out gestartet hat (Schluessel der Join-Barriere). */
  inboundFanOutRunId?: number;
  /**
   * Lauf-Historie: Mail nur im ersten Schritt, Budget für alle Details des
   * Laufs. Geteilt über alle Zweige (Klone kopieren die Referenz).
   */
  stepDetail?: WorkflowRunDetailState;
};

export type NodeResult = {
  status: WorkflowStepStatus;
  port?: string | null;
  message?: string | null;
  stop?: boolean;
  /** When true with stop, do not enqueue the next inbound priority-chain workflow. */
  inboundChainStop?: boolean;
  blocked?: boolean;
  deferred?: boolean;
  blockReason?: string | null;
  variables?: WorkflowVariableContext;
};

export type DeferredWorkflowImapEffect =
  | { kind: 'set_seen'; workspaceId: string; messageId: number }
  | {
    kind: 'move';
    workspaceId: string;
    messageId: number;
    targetFolderPath: string;
    context: ServerWorkflowContext;
    now: Date;
  }
  | {
    kind: 'delete';
    workspaceId: string;
    messageId: number;
    context: ServerWorkflowContext;
    now: Date;
  };

/**
 * Sammelbecken fuer Sichtbarkeits-Invalidierungen.
 *
 * Schreibt ein Workflow Tags oder Kategorien, kann das die Sichtbarkeit einer
 * Nachricht fuer jeden kippen, dessen Binding genau diese Werte als Filter
 * fuehrt — bei einem Ausschlussfilter wird eine bereits geladene Nachricht
 * gesperrt, bei einem Allow-Filter erscheint sie neu. Ohne Invalidierung merkt
 * der Client das erst beim naechsten Reload.
 *
 * Gesammelt wird INNERHALB der Transaktion, veroeffentlicht wird danach: ein
 * Publish vor dem Commit waere bei einem Rollback schlicht falsch. Sets statt
 * Listen, damit ein Workflow, der denselben Tag mehrfach setzt, am Ende
 * trotzdem nur eine Invalidierung ausloest.
 */
export type WorkflowVisibilityInvalidation = {
  tags: Set<string>;
  categoryIds: Set<number>;
  /**
   * Eine ZUWEISUNG kippt die Sichtbarkeit ohne Tag und ohne Kategorie: die
   * Filter assigned_to_me, assigned_to_my_groups und unassigned haengen allein
   * an assigned_to_user_id. Der manuelle Assign-Pfad (mail-routes) invalidiert
   * dafuer laengst; der Workflow-Knoten email.assign tat es nicht — betroffene
   * Nutzer sahen eine gerade gesperrte, bereits geladene Nachricht weiter.
   */
  assignmentChanged: boolean;
};

export type ServerWorkflowRuntimePorts = Readonly<{
  mssql?: Pick<MssqlSettingsPort, 'executeReadOnlyQuery'>;
  workflowImapActions?: ServerWorkflowImapActionPort;
  deferredImapEffects?: DeferredWorkflowImapEffect[];
  visibilityInvalidation?: WorkflowVisibilityInvalidation;
  aiReviewPreview?: AiReviewPreviewRunner;
  aiDraft?: WorkflowAiDraftNodeDeps;
  /** KI-Entscheidung in der Versandvorschau (synchron, echter Modellaufruf). */
  aiDecide?: WorkflowAiDecideDeps;
  /** Nur im Probelauf: KI-Antworten der Versandvorschau (Aufrufe ohne offene Transaktion). */
  previewAiMemo?: PreviewAiMemo;
}>;

/**
 * KI-Antworten der Versandvorschau. Der Probelauf läuft in kurzen
 * Transaktionen: trifft er auf eine noch unbekannte KI-Frage, bricht der
 * Durchgang ab (Rollback, der Probelauf schreibt nichts), die Frage wird ohne
 * offene Transaktion gestellt und der Durchgang mit der gemerkten Antwort
 * wiederholt. Gleiche Fragen innerhalb einer Vorschau werden nur einmal gestellt.
 */
export type PreviewAiMemo = {
  results: Map<string, unknown>;
  pending: { key: string; run: () => Promise<unknown> } | null;
};

/** Plan 043: Eingaben eines Server-Knoten-Handlers (wie executeServerNode). */
export type ServerNodeHandlerArgs = {
  trx: WorkspaceTransaction;
  doc: WorkflowGraphDocument;
  context: ServerWorkflowContext;
  node: WorkflowGraphNode;
  config: Record<string, unknown>;
  type: string;
  log: string[];
  now: Date;
  ports: ServerWorkflowRuntimePorts;
  dryRun: boolean;
};

/** null = Knoten nicht zuständig (weiter wie bisher im Ablauf). */
export type ServerNodeHandler = (args: ServerNodeHandlerArgs) => Promise<NodeResult | null>;

export type ServerNodeHandlerMap = Readonly<Record<string, ServerNodeHandler>>;

export type OptionalPositiveIntegerConfig =
  | { ok: true; value: number | undefined }
  | { ok: false; message: string };

export type BooleanConfig =
  | { ok: true; value: boolean }
  | { ok: false; message: string };
