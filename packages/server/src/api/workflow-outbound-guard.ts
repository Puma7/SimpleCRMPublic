import {
  findOutboundGraphTraps,
  formatOutboundGraphTraps,
  type WorkflowGraphDocument,
} from '@simplecrm/core';

import type { ApiResponse } from './types';
import { error } from './http';

/**
 * Shared by the workflow CRUD routes and the version-restore route: an ACTIVE
 * outbound workflow holds every draft until a path reaches a release node, so a
 * graph that cannot release traps mail forever. Extracted into its own module
 * because workflow-routes already imports workflow-runtime-routes — importing
 * back would be a cycle.
 *
 *  - compiled execution mode → never runs server-side → always traps;
 *  - no graph at all → the run never reaches a release/send node → always traps;
 *  - a graph whose reachable paths don't all release → traps (findOutboundGraphTraps).
 *
 * All inputs are the EFFECTIVE post-mutation values. A non-outbound or disabled
 * workflow can't be selected by review, so it is never rejected.
 */
export function outboundWorkflowGuardError(input: {
  graph: unknown;
  triggerName: string | undefined;
  enabled: boolean | undefined;
  executionMode: string | null | undefined;
}): ApiResponse | null {
  if (input.triggerName !== 'outbound') return null;
  if (input.enabled === false) return null;
  if ((input.executionMode ?? 'graph') === 'compiled') {
    return error(
      422,
      'outbound_workflow_traps_mail',
      'Aktiver Ausgangs-Workflow im „compiled"-Modus wird serverseitig nicht ausgeführt und hält ' +
        'jede Mail dauerhaft. Bitte auf den Graph-Modus umstellen.',
    );
  }
  if (!input.graph || typeof input.graph !== 'object') {
    return error(
      422,
      'outbound_workflow_traps_mail',
      'Aktiver Ausgangs-Workflow ohne Graph hält jede Mail dauerhaft. Bitte einen Graph mit ' +
        'Freigabe-Knoten (email.release_outbound mit autoSend=true) hinterlegen.',
    );
  }
  const issues = findOutboundGraphTraps(input.graph as WorkflowGraphDocument, {
    effectiveTrigger: 'outbound',
  });
  if (issues.length === 0) return null;
  return error(422, 'outbound_workflow_traps_mail', formatOutboundGraphTraps(issues));
}
