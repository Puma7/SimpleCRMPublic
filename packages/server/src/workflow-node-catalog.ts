import {
  listBuiltinWorkflowNodeCatalog,
  type WorkflowNodeCatalogEntry,
} from '@simplecrm/core';

import type { ServerApiPorts } from './api/types';

const SERVER_UNSUPPORTED_WORKFLOW_NODE_TYPES = new Set([
  'code.javascript',
  'code.python',
  'plugin.custom',
]);

/**
 * Desktop-only-Knoten (runtime: 'desktop' im Core-Katalog, z. B.
 * ai.draft_reply / ai.review_draft) werden generisch ausgeblendet — neue
 * Desktop-only-Nodes verschwinden damit automatisch aus dem Server-Katalog,
 * ohne dass SERVER_UNSUPPORTED_WORKFLOW_NODE_TYPES gepflegt werden muss.
 */
let desktopOnlyWorkflowNodeTypes: ReadonlySet<string> | null = null;

function getDesktopOnlyWorkflowNodeTypes(): ReadonlySet<string> {
  if (!desktopOnlyWorkflowNodeTypes) {
    desktopOnlyWorkflowNodeTypes = new Set(
      listBuiltinWorkflowNodeCatalog()
        .filter((entry) => entry.runtime === 'desktop')
        .map((entry) => entry.type),
    );
  }
  return desktopOnlyWorkflowNodeTypes;
}

export function createStaticWorkflowNodeCatalogPort(): NonNullable<ServerApiPorts['workflowNodeCatalog']> {
  return {
    list() {
      return listServerWorkflowNodeCatalog();
    },
  };
}

export function listServerWorkflowNodeCatalog(): WorkflowNodeCatalogEntry[] {
  return listBuiltinWorkflowNodeCatalog()
    .filter((entry) => entry.runtime !== 'desktop'
      && isServerWorkflowNodeTypeSupported(entry.type))
    // Feld-Ebene desselben Flags: Felder, die nur der Desktop-Executor
    // auswertet (z. B. ai.spam_score profileId/customPrompt — der Server
    // nutzt die lokale Spam-Engine statt einer KI), werden ausgeblendet
    // statt eine wirkungslose Konfiguration zu bewerben. Kopie statt
    // Mutation: die Katalog-Einträge sind geteilte Modul-Objekte.
    .map((entry) => {
      if (!entry.fields?.some((field) => field.runtime === 'desktop')) return entry;
      return {
        ...entry,
        fields: entry.fields.filter((field) => field.runtime !== 'desktop'),
      };
    });
}

export function isServerWorkflowNodeTypeSupported(type: string): boolean {
  return !SERVER_UNSUPPORTED_WORKFLOW_NODE_TYPES.has(type)
    && !getDesktopOnlyWorkflowNodeTypes().has(type);
}
