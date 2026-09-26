import {
  SENT_AI_VIEW_KINDS,
  determineSentProvenance,
  sentByBadgeLabel,
  sentByDescription,
  workflowSentByLabel,
} from '../../packages/core/src/email';

describe('Kennzeichnung „gesendet von“ (TA-P3)', () => {
  const base = { draftOriginWorkflowId: 7, draftOriginEdited: false, outboundReviewSkipped: false };

  test('Workflow-Versand ohne Mensch: KI-Entwurf ⇒ ai_auto, sonst workflow', () => {
    expect(determineSentProvenance({
      ...base,
      actor: { kind: 'workflow', workflowId: null, workflowName: 'KI-Antwort' },
      draftOriginKind: 'ai',
    })).toEqual({ kind: 'ai_auto', userId: null, workflowId: 7, label: 'Workflow „KI-Antwort“', outboundReviewSkipped: false });
    expect(determineSentProvenance({
      ...base,
      actor: { kind: 'workflow', workflowId: 9, workflowName: null },
      draftOriginKind: 'workflow',
    })).toMatchObject({ kind: 'workflow', workflowId: 9, label: null });
    expect(determineSentProvenance({
      ...base,
      actor: { kind: 'workflow', workflowId: null, workflowName: null },
      draftOriginKind: null,
    }).kind).toBe('workflow');
  });

  test('Mensch sendet: unveränderter KI-Entwurf ⇒ ai_approved, geändert oder eigener ⇒ human', () => {
    const human = { kind: 'human' as const, userId: 'u1', userLabel: 'Anna Beispiel' };
    expect(determineSentProvenance({ ...base, actor: human, draftOriginKind: 'ai' }))
      .toEqual({ kind: 'ai_approved', userId: 'u1', workflowId: 7, label: 'Anna Beispiel', outboundReviewSkipped: false });
    expect(determineSentProvenance({ ...base, actor: human, draftOriginKind: 'ai', draftOriginEdited: true }))
      .toMatchObject({ kind: 'human', userId: 'u1', workflowId: null });
    expect(determineSentProvenance({ ...base, actor: human, draftOriginKind: null }).kind).toBe('human');
    expect(determineSentProvenance({ ...base, actor: human, draftOriginKind: 'workflow' }).kind).toBe('human');
    expect(determineSentProvenance({ ...base, actor: human, draftOriginKind: null, outboundReviewSkipped: true })
      .outboundReviewSkipped).toBe(true);
  });

  test('Relay behält den Client-Namen', () => {
    expect(determineSentProvenance({
      ...base,
      actor: { kind: 'relay', clientLabel: ' Shop ' },
      draftOriginKind: null,
    })).toEqual({ kind: 'relay', userId: null, workflowId: null, label: 'Shop', outboundReviewSkipped: false });
  });

  test('Kennzeichen und Texte der Oberfläche', () => {
    expect(sentByBadgeLabel('ai_auto')).toBe('KI');
    expect(sentByBadgeLabel('ai_approved')).toBe('KI · freigegeben');
    expect(sentByBadgeLabel('workflow')).toBe('Automatik');
    expect(sentByBadgeLabel('relay')).toBe('Relay');
    expect(sentByBadgeLabel('human')).toBeNull();
    expect(sentByBadgeLabel(null)).toBeNull();
    expect(workflowSentByLabel('Auto')).toBe('Workflow „Auto“');
    expect(sentByDescription({ kind: 'human', label: 'Anna' })).toBe('Gesendet von: Anna');
    expect(sentByDescription({ kind: 'ai_auto', label: 'Workflow „Auto“' }))
      .toBe('Automatisch von KI gesendet (Workflow „Auto“)');
    expect(sentByDescription({ kind: 'ai_approved', label: 'Anna' })).toBe('KI-Entwurf, freigegeben von Anna');
    expect(sentByDescription({ kind: null, label: null })).toBeNull();
    expect([...SENT_AI_VIEW_KINDS]).toEqual(['ai_auto', 'ai_approved', 'workflow']);
  });
});
