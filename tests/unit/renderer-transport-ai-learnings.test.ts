import { IPCChannels } from '@shared/ipc/channels';
import { createHttpRendererTransport } from '@/services/transport';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

function transportWith(...responses: Response[]) {
  const fetchImpl = jest.fn();
  for (const response of responses) fetchImpl.mockResolvedValueOnce(response);
  return { fetchImpl, transport: createHttpRendererTransport({ baseUrl: 'https://crm.example.com', fetchImpl }) };
}

const call = (fetchImpl: jest.Mock, index: number) => fetchImpl.mock.calls[index] as [string, RequestInit];

describe('Learnings-Transport (TA-P5)', () => {
  test('Übersicht, Einstellungen, Einträge und Auswertung', async () => {
    const { fetchImpl, transport } = transportWith(
      jsonResponse({ data: { counts: { total: 2 } } }),
      jsonResponse({ data: { collectEnabled: true, targetKnowledgeBaseId: 3, profileId: null } }),
      jsonResponse({ data: { items: [{ id: 1, kind: 'note' }], nextCursor: null } }),
      jsonResponse({ data: { deleted: true } }),
      jsonResponse({ data: { status: 'queued', digestId: null, candidateCount: 4 } }, 202),
      jsonResponse({ data: { items: [{ id: 7, status: 'pending' }] } }),
      jsonResponse({ data: { id: 7, proposedContent: '# X' } }),
      jsonResponse({ data: { id: 9, kind: 'note' } }, 201),
    );
    await expect(transport.invoke(IPCChannels.Email.GetLearningsOverview)).resolves.toEqual({ counts: { total: 2 } });
    await expect(transport.invoke(IPCChannels.Email.SaveLearningsSettings, {
      collectEnabled: true, targetKnowledgeBaseId: 3, profileId: null,
    })).resolves.toEqual({ success: true, settings: { collectEnabled: true, targetKnowledgeBaseId: 3, profileId: null } });
    await expect(transport.invoke(IPCChannels.Email.ListLearningCandidates, { kind: 'note' }))
      .resolves.toEqual([{ id: 1, kind: 'note' }]);
    await expect(transport.invoke(IPCChannels.Email.DeleteLearningCandidate, { id: 1 })).resolves.toEqual({ success: true });
    await expect(transport.invoke(IPCChannels.Email.RunLearningsDigest, { period: 'week', knowledgeBaseId: 3 }))
      .resolves.toEqual({ status: 'queued', digestId: null, candidateCount: 4 });
    await expect(transport.invoke(IPCChannels.Email.ListLearningDigests, undefined)).resolves.toEqual([{ id: 7, status: 'pending' }]);
    await expect(transport.invoke(IPCChannels.Email.GetLearningDigest, { id: 7 })).resolves.toEqual({ id: 7, proposedContent: '# X' });
    await expect(transport.invoke(IPCChannels.Email.AddLearningNote, { text: 'Sie-Form.', messageId: 42 }))
      .resolves.toEqual({ success: true, candidate: { id: 9, kind: 'note' } });

    expect(call(fetchImpl, 0)[0]).toBe('https://crm.example.com/api/v1/ai-learnings/overview');
    expect(call(fetchImpl, 1)).toEqual([
      'https://crm.example.com/api/v1/ai-learnings/settings',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ collectEnabled: true, targetKnowledgeBaseId: 3, profileId: null }) }),
    ]);
    expect(call(fetchImpl, 2)[0]).toBe('https://crm.example.com/api/v1/ai-learnings/candidates?kind=note&limit=100');
    expect(call(fetchImpl, 3)).toEqual(['https://crm.example.com/api/v1/ai-learnings/candidates/1', expect.objectContaining({ method: 'DELETE' })]);
    expect(call(fetchImpl, 4)).toEqual([
      'https://crm.example.com/api/v1/ai-learnings/digests',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ period: 'week', knowledgeBaseId: 3 }) }),
    ]);
    expect(call(fetchImpl, 5)[0]).toBe('https://crm.example.com/api/v1/ai-learnings/digests?limit=20');
    expect(call(fetchImpl, 6)[0]).toBe('https://crm.example.com/api/v1/ai-learnings/digests/7');
    expect(call(fetchImpl, 7)).toEqual([
      'https://crm.example.com/api/v1/ai-learnings/notes',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ text: 'Sie-Form.', messageId: 42 }) }),
    ]);
  });

  test('Übernehmen: Konflikt wird wie auf dem Desktop als { success: false } gemeldet', async () => {
    const { fetchImpl, transport } = transportWith(
      jsonResponse({ data: { counts: { total: 0 } } }),
      jsonResponse({
        error: { code: 'knowledge_base_changed', message: 'Wissensbasis geändert', details: { currentContent: '# Neu' } },
      }, 409),
      jsonResponse({ data: { counts: { total: 0 } } }),
      jsonResponse({ data: { id: 7, status: 'accepted' } }),
      jsonResponse({ data: { counts: { total: 0 } } }),
      jsonResponse({ error: { code: 'ai_learning_digest_not_pending', message: 'schon entschieden' } }, 409),
      jsonResponse({ data: { counts: { total: 0 } } }),
      jsonResponse({ error: { code: 'forbidden', message: 'Keine Berechtigung' } }, 403),
    );
    await expect(transport.invoke(IPCChannels.Email.AcceptLearningDigest, { id: 7, content: '# X' })).resolves.toEqual({
      success: false,
      code: 'knowledge_base_changed',
      error: 'Wissensbasis geändert',
      currentContent: '# Neu',
    });
    await expect(transport.invoke(IPCChannels.Email.AcceptLearningDigest, { id: 7, content: '# X', confirmOverwrite: true }))
      .resolves.toEqual({ success: true, digest: { id: 7, status: 'accepted' } });
    expect(call(fetchImpl, 3)).toEqual([
      'https://crm.example.com/api/v1/ai-learnings/digests/7/accept',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ content: '# X', confirmOverwrite: true }) }),
    ]);
    await expect(transport.invoke(IPCChannels.Email.RejectLearningDigest, { id: 7 })).resolves.toEqual({
      success: false,
      code: 'not_pending',
      error: 'schon entschieden',
    });
    await expect(transport.invoke(IPCChannels.Email.RejectLearningDigest, { id: 7 })).rejects.toThrow('Keine Berechtigung');
  });
});
