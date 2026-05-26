import { IPCChannels, AllowedInvokeChannels, DeprecatedInvokeChannels } from '../../shared/ipc/channels';
import { getPayloadSchema, getResultSchema, isDeprecatedChannel } from '../../shared/ipc/schemas';

describe('IPC contracts', () => {
  test('contains key invoke channels', () => {
    expect(AllowedInvokeChannels).toContain(IPCChannels.Deals.AddProduct);
    expect(AllowedInvokeChannels).toContain(IPCChannels.Mssql.TestConnection);
    expect(DeprecatedInvokeChannels).toContain(IPCChannels.Deals.UpdateProductQuantityLegacy);
  });

  test('validates deal payload schemas', () => {
    const addPayload = {
      dealId: 1,
      productId: 2,
      quantity: 1,
      price: 19.99,
    };
    expect(() => getPayloadSchema(IPCChannels.Deals.AddProduct).parse(addPayload)).not.toThrow();
    expect(() =>
      getPayloadSchema(IPCChannels.Deals.RemoveProduct).parse({ dealId: 1 })
    ).toThrow();
  });

  test('marks deprecated channels and supports result schema', () => {
    expect(isDeprecatedChannel(IPCChannels.Deals.UpdateProductQuantityLegacy)).toBe(true);
    expect(() =>
      getResultSchema(IPCChannels.Mssql.TestConnection).parse({ success: false, error: 'boom' })
    ).not.toThrow();
  });

  test('Automation channels are in AllowedInvokeChannels', () => {
    expect(AllowedInvokeChannels).toContain(IPCChannels.Automation.GetSettings);
    expect(AllowedInvokeChannels).toContain(IPCChannels.Automation.SetSettings);
    expect(AllowedInvokeChannels).toContain(IPCChannels.Automation.GenerateApiKey);
    expect(AllowedInvokeChannels).toContain(IPCChannels.Automation.RevokeApiKey);
  });

  test('FollowUp channels are in AllowedInvokeChannels', () => {
    expect(AllowedInvokeChannels).toContain(IPCChannels.FollowUp.GetItems);
    expect(AllowedInvokeChannels).toContain(IPCChannels.FollowUp.GetQueueCounts);
    expect(AllowedInvokeChannels).toContain(IPCChannels.FollowUp.SnoozeTask);
    expect(AllowedInvokeChannels).toContain(IPCChannels.FollowUp.LogActivity);
    expect(AllowedInvokeChannels).toContain(IPCChannels.FollowUp.GetTimeline);
    expect(AllowedInvokeChannels).toContain(IPCChannels.FollowUp.GetSavedViews);
    expect(AllowedInvokeChannels).toContain(IPCChannels.FollowUp.CreateSavedView);
    expect(AllowedInvokeChannels).toContain(IPCChannels.FollowUp.DeleteSavedView);
  });

  test('FollowUp channels have registered payload and result schemas', () => {
    const followUpChannels = Object.values(IPCChannels.FollowUp);
    for (const channel of followUpChannels) {
      expect(() => getPayloadSchema(channel as any)).not.toThrow();
      expect(() => getResultSchema(channel as any)).not.toThrow();
    }
  });

  test('FollowUp.SnoozeTask payload validates required fields', () => {
    expect(() =>
      getPayloadSchema(IPCChannels.FollowUp.SnoozeTask).parse({ taskId: 1, snoozedUntil: '2026-03-20' })
    ).not.toThrow();
    expect(() =>
      getPayloadSchema(IPCChannels.FollowUp.SnoozeTask).parse({})
    ).toThrow();
  });

  test('FollowUp.CreateSavedView payload validates required fields', () => {
    expect(() =>
      getPayloadSchema(IPCChannels.FollowUp.CreateSavedView).parse({ name: 'My View', filters: '{}' })
    ).not.toThrow();
    expect(() =>
      getPayloadSchema(IPCChannels.FollowUp.CreateSavedView).parse({ name: 'My View' })
    ).toThrow();
  });

  test('Email channels have registered payload and result schemas', () => {
    const emailChannels = Object.values(IPCChannels.Email);
    for (const channel of emailChannels) {
      expect(() => getPayloadSchema(channel as any)).not.toThrow();
      expect(() => getResultSchema(channel as any)).not.toThrow();
    }
  });

  test('Email signature IPC payloads validate', () => {
    expect(() =>
      getPayloadSchema(IPCChannels.Email.GetComposeSignature).parse({ accountId: 1 })
    ).not.toThrow();
    expect(() =>
      getPayloadSchema(IPCChannels.Email.SaveAccountSignature).parse({
        accountId: 1,
        signatureHtml: '<p>Hi</p>',
      })
    ).not.toThrow();
    expect(() =>
      getResultSchema(IPCChannels.Email.GetComposeSignature).parse({ html: '<p>x</p>' })
    ).not.toThrow();
    expect(() =>
      getResultSchema(IPCChannels.Email.ListAccountSignatures).parse([
        { account_id: 1, display_name: 'A', email_address: 'a@x.de', signature_html: null },
      ])
    ).not.toThrow();
  });

  test('Email.GetAiSettings result accepts profiles and providerPresets', () => {
    expect(() =>
      getResultSchema(IPCChannels.Email.GetAiSettings).parse({
        success: true,
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        embeddingModel: 'text-embedding-3-small',
        profiles: [
          {
            id: 1,
            label: 'Standard',
            provider: 'openai',
            baseUrl: 'https://api.openai.com/v1',
            model: 'gpt-4o-mini',
            embeddingModel: null,
            isDefault: true,
          },
        ],
        providerPresets: {
          openai: {
            label: 'OpenAI',
            baseUrl: 'https://api.openai.com/v1',
            defaultModel: 'gpt-4o-mini',
          },
        },
      }),
    ).not.toThrow();
  });

  test('Email.SaveAiProfile payload preserves apiKey', () => {
    const parsed = getPayloadSchema(IPCChannels.Email.SaveAiProfile).parse({
      id: 1,
      label: 'Open Router',
      provider: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'anthropic/claude-3.5-sonnet',
      apiKey: 'sk-or-v1-test-secret',
    }) as { apiKey?: string };
    expect(parsed.apiKey).toBe('sk-or-v1-test-secret');
  });

  test('Email.AddKnowledgeChunk payload accepts title and content', () => {
    expect(() =>
      getPayloadSchema(IPCChannels.Email.AddKnowledgeChunk).parse({
        knowledgeBaseId: 1,
        title: 'FAQ',
        content: 'Antwort hier',
      }),
    ).not.toThrow();
  });

  test('Dashboard list payloads accept optional limit', () => {
    expect(() => getPayloadSchema(IPCChannels.Dashboard.GetRecentCustomers).parse(5)).not.toThrow();
    expect(() => getPayloadSchema(IPCChannels.Dashboard.GetRecentCustomers).parse(undefined)).not.toThrow();
    expect(() => getPayloadSchema(IPCChannels.Dashboard.GetUpcomingTasks).parse(3)).not.toThrow();
  });

  test('Email.SendCompose payload validates required fields', () => {
    expect(() =>
      getPayloadSchema(IPCChannels.Email.SendCompose).parse({
        accountId: 1,
        draftMessageId: 2,
        subject: 'Hi',
        bodyText: 'Text',
        to: 'a@example.com',
      })
    ).not.toThrow();
    expect(() =>
      getPayloadSchema(IPCChannels.Email.SendCompose).parse({ accountId: 1 })
    ).toThrow();
  });

  test('Email.CompileWorkflowGraph accepts canvas graph document from UI', () => {
    const graphDoc = {
      version: 1 as const,
      nodes: [
        { id: 't1', type: 'trigger' as const, data: { kind: 'inbound' as const } },
        {
          id: 'a1',
          type: 'action' as const,
          data: { actionType: 'tag' as const, tag: 'Test' },
        },
      ],
      edges: [{ id: 'e1', source: 't1', target: 'a1' }],
    };
    expect(() => getPayloadSchema(IPCChannels.Email.CompileWorkflowGraph).parse(graphDoc)).not.toThrow();
    expect(() =>
      getResultSchema(IPCChannels.Email.CompileWorkflowGraph).parse({
        success: true,
        definitionJson: '{}',
        registryOnly: false,
      }),
    ).not.toThrow();
  });

  test('Email.OpenAttachmentPath supports risky confirmation flow', () => {
    expect(() =>
      getPayloadSchema(IPCChannels.Email.OpenAttachmentPath).parse({
        attachmentId: 1,
        confirmOpenRisky: true,
      }),
    ).not.toThrow();
    expect(() =>
      getResultSchema(IPCChannels.Email.OpenAttachmentPath).parse({
        success: false,
        needsConfirmation: true,
        reason: 'risky_file_type',
      }),
    ).not.toThrow();
  });
});
