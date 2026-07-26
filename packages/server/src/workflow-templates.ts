import { WORKFLOW_TEMPLATES, type WorkflowTemplate } from '@simplecrm/core';

import type { ServerApiPorts } from './api';
import { isServerWorkflowNodeTypeSupported } from './workflow-node-catalog';

/**
 * Nur Vorlagen anbieten, deren sämtliche Registry-Knoten der Server auch
 * ausführen kann. Vorlagen mit nicht unterstützten Knoten (z. B. code.javascript)
 * würden sich sonst im HTTP-Modus zwar laden und speichern lassen, blieben aber
 * zur Laufzeit am nicht unterstützten Knoten stecken. Engine-Primitive
 * (trigger/condition/switch/…) sind immer da — geprüft wird nur data.nodeType.
 * Zwei-Stufen-KI-Antwort (ai.draft_reply / ai.review_draft) ist serverfähig.
 */
export function listServerWorkflowTemplates(): WorkflowTemplate[] {
  return WORKFLOW_TEMPLATES.filter((template) =>
    template.graph.nodes.every((node) => {
      const nodeType = node.data.nodeType;
      return typeof nodeType !== 'string' || isServerWorkflowNodeTypeSupported(nodeType);
    }),
  );
}

export function createStaticWorkflowTemplatePort(): NonNullable<ServerApiPorts['workflowTemplates']> {
  return {
    list() {
      return listServerWorkflowTemplates();
    },
  };
}
