import type { WorkflowGraphNode } from '../../shared/email-workflow-graph';
import { LEGACY_ACTION_MAP } from './registry';

const INBOUND_DIRECT_ALLOWED_REGISTRY = new Set(['email.sender_filter', 'ai.classify']);

const INBOUND_ROUTING_PREFIXES = ['logic.'];

function registryTypeOf(node: WorkflowGraphNode): string | undefined {
  if (node.type !== 'registry' && node.type !== 'action') return undefined;
  const data = node.data as Record<string, unknown>;
  if (data.nodeType) return String(data.nodeType);
  const actionType = String(data.actionType ?? '');
  return LEGACY_ACTION_MAP[actionType];
}

/** Inbound graphs: side-effect nodes need a prior matching Bedingung (or explicit allow). */
export function inboundNodeRequiresConditionGate(node: WorkflowGraphNode): boolean {
  if (node.type === 'condition' || node.type === 'trigger') return false;
  if (node.type === 'action') return true;
  if (node.type !== 'registry') return false;
  const reg = registryTypeOf(node);
  if (!reg) return true;
  if (INBOUND_DIRECT_ALLOWED_REGISTRY.has(reg)) return false;
  if (INBOUND_ROUTING_PREFIXES.some((p) => reg.startsWith(p))) return false;
  const data = node.data as Record<string, unknown>;
  const cfg = (
    data.config && typeof data.config === 'object' ? data.config : {}
  ) as Record<string, unknown>;
  if (cfg.runOnEveryInbound === true) return false;
  return true;
}
