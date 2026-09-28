/**
 * Plan 043: Handler-Tabellen aller Server-Knoten (vor und nach dem Dry-Run-Schutz).
 */
import { LOGIC_PRE_GUARD_HANDLERS, LOGIC_NODE_HANDLERS } from './logic';
import { AI_PRE_GUARD_HANDLERS, AI_NODE_HANDLERS } from './ai';
import { SPAM_NODE_HANDLERS } from './spam';
import { OUTBOUND_NODE_HANDLERS } from './outbound';
import { MESSAGE_NODE_HANDLERS } from './message';
import { IMAP_NODE_HANDLERS } from './imap';
import { CRM_NODE_HANDLERS } from './crm';
import { INTEGRATION_NODE_HANDLERS } from './integration';
import { ERP_NODE_HANDLERS } from './erp';
import { serverNodeHandlerMap } from './shared';
import type { ServerNodeHandler, ServerNodeHandlerMap } from './types';

/** Wirft beim Laden, wenn ein Knotentyp in zwei Kategorien steht. */
function mergeHandlerTables(tables: ReadonlyArray<Readonly<Record<string, ServerNodeHandler>>>): ServerNodeHandlerMap {
  const merged: Record<string, ServerNodeHandler> = {};
  for (const table of tables) {
    for (const [type, handler] of Object.entries(table)) {
      if (Object.prototype.hasOwnProperty.call(merged, type)) {
        throw new Error(`Server-Knoten ${type} hat zwei Handler`);
      }
      merged[type] = handler;
    }
  }
  return serverNodeHandlerMap(merged);
}

/** Knoten vor dem Dry-Run-Schutz (Logik, KI-Entscheidung, Versandvorschau, Learnings). */
export const PRE_DRY_RUN_GUARD_HANDLERS: ServerNodeHandlerMap = mergeHandlerTables([
  LOGIC_PRE_GUARD_HANDLERS,
  AI_PRE_GUARD_HANDLERS,
]);

/** Alle übrigen Knoten (nach dem Dry-Run-Schutz). */
export const SERVER_NODE_HANDLERS: ServerNodeHandlerMap = mergeHandlerTables([
  LOGIC_NODE_HANDLERS,
  AI_NODE_HANDLERS,
  SPAM_NODE_HANDLERS,
  OUTBOUND_NODE_HANDLERS,
  MESSAGE_NODE_HANDLERS,
  IMAP_NODE_HANDLERS,
  CRM_NODE_HANDLERS,
  INTEGRATION_NODE_HANDLERS,
  ERP_NODE_HANDLERS,
]);
