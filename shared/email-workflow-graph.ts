/**
 * React Flow (xyflow) graph shape for email workflows — stored in `email_workflows.graph_json`.
 */

export type WorkflowGraphTriggerKind = 'inbound' | 'outbound' | 'draft_created' | 'schedule';

export type GraphTriggerNodeData = {
  kind: WorkflowGraphTriggerKind;
};

export type GraphConditionNodeData = {
  field: 'subject' | 'body_text' | 'snippet' | 'from_address' | 'combined_text' | 'to_address' | 'cc_address';
  op: 'contains' | 'equals' | 'regex' | 'domain_ends_with';
  value: string;
  caseInsensitive?: boolean;
};

export type GraphActionNodeData =
  | { actionType: 'tag'; tag: string }
  | { actionType: 'mark_seen' }
  | { actionType: 'archive' }
  | { actionType: 'hold_outbound'; reason: string }
  | { actionType: 'set_category'; path: string }
  | { actionType: 'link_customer' }
  | { actionType: 'forward_copy'; to: string }
  | { actionType: 'tag_attachment_meta'; tag: string }
  | { actionType: 'stop' };

export type WorkflowGraphNode = {
  id: string;
  type: 'trigger' | 'condition' | 'action';
  data: GraphTriggerNodeData | GraphConditionNodeData | GraphActionNodeData;
};

export type WorkflowGraphEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
};

export type WorkflowGraphDocument = {
  version: 1;
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
};
