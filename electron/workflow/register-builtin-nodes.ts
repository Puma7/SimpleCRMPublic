import { registerWorkflowNode } from './registry';
import { registerEmailNodes } from './nodes/email-nodes';
import { registerCrmNodes } from './nodes/crm-nodes';
import { registerAiNodes } from './nodes/ai-nodes';
import { registerLogicNodes } from './nodes/logic-nodes';
import { registerCodeNodes } from './nodes/code-nodes';
import { registerIntegrationNodes } from './nodes/integration-nodes';

registerEmailNodes(registerWorkflowNode);
registerCrmNodes(registerWorkflowNode);
registerAiNodes(registerWorkflowNode);
registerLogicNodes(registerWorkflowNode);
registerCodeNodes(registerWorkflowNode);
registerIntegrationNodes(registerWorkflowNode);
