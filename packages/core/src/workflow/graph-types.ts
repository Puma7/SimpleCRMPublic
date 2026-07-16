export type WorkflowGraphTriggerKind =
  | 'inbound'
  | 'outbound'
  | 'draft_created'
  | 'schedule'
  | 'manual'
  | 'relay'
  | 'crm.deal_stage_changed'
  | 'crm.customer_created'
  | 'task.due'
  | 'calendar.event_start'
  | 'webhook.incoming';

export type GraphTriggerNodeData = {
  kind: WorkflowGraphTriggerKind;
};

export type GraphConditionField =
  | 'subject'
  | 'body_text'
  | 'snippet'
  | 'from_address'
  | 'combined_text'
  | 'to_address'
  | 'cc_address'
  | 'has_attachments'
  | 'attachment_names'
  | 'attachment_types';

export type GraphConditionOp =
  | 'contains'
  | 'equals'
  | 'regex'
  | 'domain_ends_with'
  | 'is_true'
  | 'is_false';

export type GraphConditionNodeData = {
  field: GraphConditionField;
  op: GraphConditionOp;
  value: string;
  caseInsensitive?: boolean;
  negated?: boolean;
};

export type GraphActionNodeData =
  | { actionType: 'tag'; tag: string }
  | { actionType: 'mark_seen' }
  | { actionType: 'archive' }
  | { actionType: 'hold_outbound'; reason: string }
  | { actionType: 'set_category'; path: string }
  | { actionType: 'link_customer' }
  | { actionType: 'forward_copy'; to: string; includeAttachments?: boolean; runOutboundReview?: boolean }
  | { actionType: 'tag_attachment_meta'; tag: string }
  | { actionType: 'ai_review'; promptId: number; blockKeyword?: string }
  | { actionType: 'stop' };

export type GraphRegistryNodeData = {
  nodeType: string;
  config: Record<string, unknown>;
  expertJson?: string;
  label?: string;
};

export type WorkflowGraphEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
};

export type WorkflowGraphNode = {
  id: string;
  type: 'trigger' | 'condition' | 'action' | 'registry' | string;
  data: Record<string, unknown>;
  position?: {
    x: number;
    y: number;
  };
};

export type WorkflowGraphDocument = {
  version: 1;
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
};
