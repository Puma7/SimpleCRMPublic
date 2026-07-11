import {
  defaultLabelForConnection,
  edgeLabelOptionsForSource,
  edgeSourceHandleFromLabel,
  isEdgeLabelValidForSource,
  normalizeEdgeLabelForSource,
  parseSwitchCases,
  switchCaseHandles,
} from '../../src/components/email/workflow/workflow-edge-labels';
import { decideWorkflowReturnOutcomePort } from '../../packages/server/src/workflow-execution';

describe('workflow editor edge label helpers', () => {
  test('parses switch cases as trimmed unique handle labels', () => {
    expect(parseSwitchCases(' Rechnung, support,Rechnung,  vertrieb ,,')).toEqual([
      'rechnung',
      'support',
      'vertrieb',
    ]);
    expect(switchCaseHandles({ cases: 'A,B' })).toEqual(['a', 'b', 'default']);
  });

  test('maps condition labels and handles consistently', () => {
    const source = { type: 'condition', data: {} };
    expect(normalizeEdgeLabelForSource(source, 'yes')).toBe('ja');
    expect(normalizeEdgeLabelForSource(source, 'false')).toBe('nein');
    expect(edgeSourceHandleFromLabel('ja', source)).toBe('yes');
    expect(edgeSourceHandleFromLabel('nein', source)).toBe('no');
    expect(defaultLabelForConnection(source, 'no', [], 'c1')).toBe('nein');
  });

  test('limits typed branch labels to the source node ports', () => {
    const threshold = { type: 'registry', data: { nodeType: 'logic.threshold' } };
    const senderFilter = { type: 'registry', data: { nodeType: 'email.sender_filter' } };
    const loop = { type: 'registry', data: { nodeType: 'logic.loop' } };

    expect(edgeLabelOptionsForSource(threshold).labels).toEqual(['yes', 'no']);
    expect(edgeLabelOptionsForSource(senderFilter).labels).toEqual([
      'whitelist',
      'blacklist',
      'default',
    ]);
    expect(edgeLabelOptionsForSource(loop).labels).toEqual(['each', 'done']);
  });

  test('marks stale switch labels invalid when cases change', () => {
    const source = {
      type: 'registry',
      data: { nodeType: 'logic.switch', config: { cases: 'rechnung,support' } },
    };
    expect(isEdgeLabelValidForSource(source, 'support')).toBe(true);
    expect(isEdgeLabelValidForSource(source, 'vertrieb')).toBe(false);
    expect(edgeSourceHandleFromLabel('vertrieb', source)).toBeUndefined();
  });

  test('accepts legacy registryType metadata for label options', () => {
    const source = { type: 'registry', data: { registryType: 'logic.loop' } };
    expect(edgeLabelOptionsForSource(source).labels).toEqual(['each', 'done']);
    expect(edgeSourceHandleFromLabel('fertig', source)).toBe('done');
  });

  test('fallback handles (vor dem Katalog-Fetch) sind beschriftbar — jeder Canvas-Fallback-Port hat Label-Optionen', () => {
    // Katalog-Cache ist im Test leer — genau die Situation vor dem ersten
    // IPC-Fetch. Ohne FALLBACK_PORTS in den Label-Helfern blieben Kanten aus
    // diesen Handles unbeschriftet und der Zweig liefe nie (pickEdge matcht
    // Labels).
    const autoReply = { type: 'registry', data: { nodeType: 'email.auto_reply' } };
    expect(edgeLabelOptionsForSource(autoReply)).toEqual({
      restricted: true,
      labels: ['approved', 'blocked'],
    });
    expect(defaultLabelForConnection(autoReply, 'approved', [], 'g1')).toBe('approved');
    expect(edgeSourceHandleFromLabel('blocked', autoReply)).toBe('blocked');
    // Auch Port-LABELS werden auf die ID normalisiert (wie mit Katalog).
    expect(normalizeEdgeLabelForSource(autoReply, 'Erlaubt')).toBe('approved');

    const reviewDraft = { type: 'registry', data: { nodeType: 'ai.review_draft' } };
    expect(edgeLabelOptionsForSource(reviewDraft).labels).toEqual(['send', 'hold']);
    expect(defaultLabelForConnection(reviewDraft, 'hold', [], 'r1')).toBe('hold');

    const authCheck = { type: 'registry', data: { nodeType: 'email.auth_check' } };
    expect(edgeLabelOptionsForSource(authCheck).labels).toEqual([
      'pass',
      'fail',
      'none',
      'default',
    ]);
    expect(edgeSourceHandleFromLabel('pass', authCheck)).toBe('pass');
  });

  test('every port the returns.evaluate engine can emit is wireable in the editor', () => {
    const source = { type: 'registry', data: { nodeType: 'returns.evaluate' } };
    // Drive the real server-side decision function through every defaultOutcome
    // it accepts; each resulting port (plus the no-return fallback) must be a
    // valid edge label, or a configured decision becomes silently unwireable.
    const emittablePorts = new Set<string>(['no_return', 'needs_review']);
    for (const outcome of ['refund', 'exchange', 'credit', 'keep', 'needs_review']) {
      emittablePorts.add(decideWorkflowReturnOutcomePort({
        itemConditions: [],
        itemReasonCodes: [],
        config: { defaultOutcome: outcome },
      }));
    }
    for (const port of emittablePorts) {
      expect({ port, valid: isEdgeLabelValidForSource(source, port) })
        .toEqual({ port, valid: true });
      expect(edgeSourceHandleFromLabel(port, source)).toBe(port);
    }
  });
});
