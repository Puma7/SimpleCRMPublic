import { WORKFLOW_TEMPLATES } from '@simplecrm/core';

import type { ServerApiPorts } from './api';

export function createStaticWorkflowTemplatePort(): NonNullable<ServerApiPorts['workflowTemplates']> {
  return {
    list() {
      return WORKFLOW_TEMPLATES;
    },
  };
}
