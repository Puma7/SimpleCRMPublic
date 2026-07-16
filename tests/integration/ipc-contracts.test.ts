import fs from 'fs';
import path from 'path';
import {
  IPCChannels,
  AllowedInvokeChannels,
  DeprecatedInvokeChannels,
  DesktopServerOnlyInvokeChannels,
} from '../../shared/ipc/channels';
import { getPayloadSchema, getResultSchema, isDeprecatedChannel } from '../../shared/ipc/schemas';

describe('IPC contracts', () => {
  test('contains key invoke channels', () => {
    expect(AllowedInvokeChannels).toContain(IPCChannels.Deals.AddProduct);
    expect(AllowedInvokeChannels).toContain(IPCChannels.Mssql.TestConnection);
    expect(AllowedInvokeChannels).toContain(IPCChannels.Setup.GetDeployConfig);
    expect(AllowedInvokeChannels).toContain(IPCChannels.Setup.SaveDeployConfig);
    expect(AllowedInvokeChannels).toContain(IPCChannels.Setup.ResetDeployConfig);
    expect(DeprecatedInvokeChannels).toContain(IPCChannels.Deals.UpdateProductQuantityLegacy);
  });

  test('Setup deploy config schemas validate first-start wizard IPC', () => {
    expect(() =>
      getResultSchema(IPCChannels.Setup.GetDeployConfig).parse({ status: 'missing' })
    ).not.toThrow();
    expect(() =>
      getResultSchema(IPCChannels.Setup.GetDeployConfig).parse({
        status: 'ok',
        config: {
          version: 1,
          mode: 'server-client',
          selectedAt: '2026-06-03T12:00:00.000Z',
          server: { baseUrl: 'https://crm.example.com' },
        },
      })
    ).not.toThrow();
    expect(() =>
      getPayloadSchema(IPCChannels.Setup.SaveDeployConfig).parse({
        mode: 'server-client',
        server: { baseUrl: 'https://crm.example.com' },
      })
    ).not.toThrow();
    expect(() =>
      getPayloadSchema(IPCChannels.Setup.SaveDeployConfig).parse({
        mode: 'server-client',
        server: { baseUrl: 'file:///tmp/simplecrm' },
      })
    ).toThrow();
    expect(() => getPayloadSchema(IPCChannels.Setup.ResetDeployConfig).parse(undefined)).not.toThrow();
    expect(() => getResultSchema(IPCChannels.Setup.ResetDeployConfig).parse({ success: true })).not.toThrow();
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

  test('accepts renderer payloads used by desktop CRM list and task flows', () => {
    expect(() =>
      getPayloadSchema(IPCChannels.Tasks.GetAll).parse({
        limit: 10,
        offset: 0,
        filter: { completed: false, priority: 'High', query: 'kunde' },
      })
    ).not.toThrow();
    expect(() =>
      getPayloadSchema(IPCChannels.Deals.GetAll).parse({
        limit: 10,
        offset: 0,
        filter: { query: 'renewal', stage: 'Angebot', customer_id: 2 },
      })
    ).not.toThrow();
    expect(() => getPayloadSchema(IPCChannels.Db.GetCustomers).parse(false)).not.toThrow();
    expect(() =>
      getPayloadSchema(IPCChannels.Db.GetCustomers).parse({
        paginated: true,
        includeCustomFields: false,
        limit: 50,
        offset: 100,
        query: 'Meyer',
        status: 'Active',
        sortBy: 'fullName',
        sortDirection: 'desc',
      })
    ).not.toThrow();
    expect(() =>
      getResultSchema(IPCChannels.Db.GetCustomers).parse({ items: [{ id: 1 }], total: 650000 })
    ).not.toThrow();
    expect(() => getPayloadSchema(IPCChannels.Calendar.GetCalendarEvents).parse(undefined)).not.toThrow();
    expect(() =>
      getPayloadSchema(IPCChannels.Tasks.ToggleCompletion).parse({ taskId: 1, completed: true })
    ).not.toThrow();
    expect(() =>
      getPayloadSchema(IPCChannels.Deals.UpdateStage).parse({ dealId: 1, newStage: 'Gewonnen' })
    ).not.toThrow();
    expect(() => getPayloadSchema(IPCChannels.Db.SearchCustomers).parse(['ACME', 20])).not.toThrow();
    expect(() => getPayloadSchema(IPCChannels.Products.Search).parse({ query: 'SKU', limit: 10 })).not.toThrow();
  });

  test('validates destructive CRM results and custom-field value payloads', () => {
    for (const channel of [
      IPCChannels.Db.DeleteCustomer,
      IPCChannels.Products.Delete,
      IPCChannels.CustomFields.Delete,
      IPCChannels.CustomFields.DeleteValue,
    ]) {
      expect(() => getResultSchema(channel).parse({ success: true })).not.toThrow();
      expect(() => getResultSchema(channel).parse({ success: false, error: 'blocked' })).not.toThrow();
    }

    expect(() =>
      getPayloadSchema(IPCChannels.CustomFields.SetValue).parse({
        customerId: 1,
        fieldId: 2,
        value: 'gold',
      })
    ).not.toThrow();
    expect(() =>
      getPayloadSchema(IPCChannels.CustomFields.DeleteValue).parse({ customerId: 1, fieldId: 2 })
    ).not.toThrow();
  });

  test('preserves V2 email evidence and IP-insight policy fields', () => {
    const parsedPolicy = getResultSchema(IPCChannels.Email.GetEmailTrackingSettings).parse({
      enabled: true,
      trackOpens: true,
      trackLinks: true,
      collectDerivedMetadata: true,
      collectRawMetadata: true,
      ipInsightsEnabled: true,
      rawMetadataRetentionDays: 30,
      eventRetentionDays: 365,
      tokenTtlDays: 90,
      legalBasis: 'consent',
      privacyNoticeUrl: null,
      complianceAcknowledgedAt: '2026-07-15T10:00:00.000Z',
      publicBaseUrl: 'https://crm.example',
      updatedAt: '2026-07-15T10:00:00.000Z',
    }) as Record<string, unknown>;
    expect(parsedPolicy.ipInsightsEnabled).toBe(true);

    const parsedTimeline = getResultSchema(IPCChannels.Email.GetMessageTracking).parse({
      messageId: 41,
      tracked: true,
      warning: null,
      summary: {
        transport: 'smtp_accepted',
        delivery: 'external_system_reached',
        engagement: 'link_interaction',
        confidence: 'high',
        mdnDisplayedCount: 0,
        pixelFetchCount: 0,
        automatedPixelFetchCount: 0,
        unknownPixelFetchCount: 0,
        probableHumanPixelFetchCount: 0,
        probableHumanOpenSessionCount: 0,
        automatedLinkFetchCount: 1,
        unknownLinkFetchCount: 0,
        probableHumanLinkFetchCount: 0,
        firstPixelFetchedAt: null,
        lastPixelFetchedAt: null,
        firstProbableHumanOpenAt: null,
        lastProbableHumanOpenAt: null,
        openCount: 0,
        clickCount: 1,
        automatedOpenCount: 0,
        probableOpenCount: 0,
        automatedClickCount: 0,
        probableClickCount: 1,
        firstOpenedAt: null,
        lastOpenedAt: null,
        firstClickedAt: '2026-07-15T10:00:00.000Z',
        lastClickedAt: '2026-07-15T10:00:00.000Z',
        repliedAt: null,
      },
      events: [{
        id: '9007199254740993',
        type: 'click',
        source: 'tracking_link',
        confidence: 'high',
        automated: false,
        occurredAt: '2026-07-15T10:00:00.000Z',
        metadata: {},
        classification: {
          version: 2,
          actorClass: 'security_scanner',
          confidence: 'high',
          reasons: ['known_scanner_user_agent'],
        },
      }],
      eventsTruncated: false,
    }) as {
      summary: Record<string, unknown>;
      events: Array<Record<string, unknown>>;
    };
    expect(parsedTimeline.summary.automatedLinkFetchCount).toBe(1);
    expect(parsedTimeline.events[0]).toMatchObject({
      id: '9007199254740993',
      classification: { actorClass: 'security_scanner' },
    });
  });

  test('accepts legacy email evidence payloads with safe policy defaults', () => {
    const parsedPolicy = getResultSchema(IPCChannels.Email.GetEmailTrackingSettings).parse({
      enabled: true,
      trackOpens: true,
      trackLinks: true,
      collectDerivedMetadata: true,
      collectRawMetadata: true,
      rawMetadataRetentionDays: 30,
      eventRetentionDays: 365,
      tokenTtlDays: 90,
      legalBasis: null,
      privacyNoticeUrl: null,
      complianceAcknowledgedAt: null,
      publicBaseUrl: 'https://crm.example',
      updatedAt: null,
    }) as Record<string, unknown>;
    expect(parsedPolicy.ipInsightsEnabled).toBe(false);

    expect(() => getResultSchema(IPCChannels.Email.GetMessageTracking).parse({
      messageId: 41,
      tracked: true,
      warning: null,
      summary: {
        transport: 'smtp_accepted',
        delivery: 'unknown',
        engagement: 'link_interaction',
        confidence: 'medium',
        openCount: 0,
        clickCount: 1,
        firstOpenedAt: null,
        lastOpenedAt: null,
        firstClickedAt: '2026-07-15T10:00:00.000Z',
        lastClickedAt: '2026-07-15T10:00:00.000Z',
        repliedAt: null,
      },
      events: [{
        id: 1,
        type: 'click',
        source: 'tracking_link',
        confidence: 'medium',
        automated: false,
        occurredAt: '2026-07-15T10:00:00.000Z',
        metadata: {},
      }],
      eventsTruncated: false,
    })).not.toThrow();
  });

  test('marks deprecated channels and supports result schema', () => {
    expect(isDeprecatedChannel(IPCChannels.Deals.UpdateProductQuantityLegacy)).toBe(true);
    expect(() =>
      getResultSchema(IPCChannels.Mssql.TestConnection).parse({ success: false, error: 'boom' })
    ).not.toThrow();
    expect(() =>
      getResultSchema(IPCChannels.Mssql.GetSettings).parse(null)
    ).not.toThrow();
  });

  test('Automation channels are in AllowedInvokeChannels', () => {
    expect(AllowedInvokeChannels).toContain(IPCChannels.Automation.GetSettings);
    expect(AllowedInvokeChannels).toContain(IPCChannels.Automation.SetSettings);
    expect(AllowedInvokeChannels).toContain(IPCChannels.Automation.GenerateApiKey);
    expect(AllowedInvokeChannels).toContain(IPCChannels.Automation.RevokeApiKey);
  });

  test('server-only Returns and UserGroups channels are not exposed via desktop preload IPC', () => {
    const serverOnly = new Set<string>(DesktopServerOnlyInvokeChannels);
    for (const channel of [
      ...Object.values(IPCChannels.Returns),
      ...Object.values(IPCChannels.UserGroups),
    ]) {
      expect(serverOnly.has(channel)).toBe(true);
      expect(AllowedInvokeChannels).not.toContain(channel as never);
    }
  });

  test('desktop workflow execute-now IPC requires owner or admin role', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'electron/ipc/workflow.ts'), 'utf8');
    expect(source).toMatch(/IPCChannels\.Email\.ExecuteWorkflowNow[\s\S]*requireRole:\s*\['owner',\s*'admin'\]/);
  });

  test('desktop workflow test-on-message IPC cannot opt into live execution', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'electron/ipc/workflow.ts'), 'utf8');
    const handler = source.match(/IPCChannels\.Email\.TestWorkflowOnMessage[\s\S]*?\n\s*\),\n\s*\);/)?.[0] ?? '';
    expect(handler).toContain('testWorkflowOnMessage');
    expect(handler).not.toContain('payload.dryRun !== false');
    expect(handler).toMatch(/testWorkflowOnMessage\(payload\.workflowId,\s*payload\.messageId,\s*true\)/);
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

  test('PGP channels have registered payload and result schemas', () => {
    const pgpChannels = Object.values(IPCChannels.Pgp);
    for (const channel of pgpChannels) {
      expect(() => getPayloadSchema(channel as any)).not.toThrow();
      expect(() => getResultSchema(channel as any)).not.toThrow();
    }
  });

  test('PGP plaintext schemas accept optional Base64 attachment payloads', () => {
    expect(() =>
      getPayloadSchema(IPCChannels.Pgp.EncryptMessage).parse({
        plaintext: 'Hello',
        recipientEmails: ['peer@example.com'],
        attachments: [{
          filename: 'invoice.pdf',
          contentType: 'application/pdf',
          contentBase64: 'aW52b2ljZQ==',
        }],
      }),
    ).not.toThrow();
    expect(() =>
      getPayloadSchema(IPCChannels.Pgp.SignMessage).parse({
        plaintext: 'Hello',
        passphrase: ' passphrase ',
        attachments: [{
          filename: 'note.txt',
          contentBase64: 'bm90ZQ==',
        }],
      }),
    ).not.toThrow();
    expect(() =>
      getResultSchema(IPCChannels.Pgp.EncryptMessage).parse({
        armored: '-----BEGIN PGP MESSAGE-----',
        attachments: [{
          filename: 'invoice.pdf.pgp',
          contentType: 'application/pgp-encrypted',
          contentBase64: 'ZW5jcnlwdGVk',
        }],
      }),
    ).not.toThrow();
    expect(() =>
      getPayloadSchema(IPCChannels.Pgp.EncryptMessage).parse({
        plaintext: 'Hello',
        recipientEmails: ['peer@example.com'],
        attachments: [{
          filename: '',
          contentBase64: 'aW52b2ljZQ==',
        }],
      }),
    ).toThrow();
    expect(() =>
      getPayloadSchema(IPCChannels.Pgp.EncryptMessage).parse({
        plaintext: 'Hello',
        recipientEmails: ['peer@example.com'],
        attachments: [{
          filename: 'invoice.pdf',
          contentBase64: 'not base64',
        }],
      }),
    ).toThrow();
  });

  test('Email channels have registered payload and result schemas', () => {
    const emailChannels = Object.values(IPCChannels.Email);
    for (const channel of emailChannels) {
      expect(() => getPayloadSchema(channel as any)).not.toThrow();
      expect(() => getResultSchema(channel as any)).not.toThrow();
    }
  });

  test('validates message tracking insight and reclassification contracts', () => {
    const insightPayload = getPayloadSchema(IPCChannels.Email.GetMessageTrackingIpInsight);
    const insightResult = getResultSchema(IPCChannels.Email.GetMessageTrackingIpInsight);
    const reclassifyPayload = getPayloadSchema(IPCChannels.Email.ReclassifyMessageTracking);
    const reclassifyResult = getResultSchema(IPCChannels.Email.ReclassifyMessageTracking);

    expect(() => insightPayload.parse({ messageId: 41, eventId: '9007199254740993' })).not.toThrow();
    expect(() => insightPayload.parse({ messageId: 0, eventId: '' })).toThrow();
    expect(() => insightResult.parse({
      ipAddress: '8.8.8.8',
      ipFamily: 'ipv4',
      scope: 'public',
      countryCode: 'US',
      continentCode: 'NA',
      asn: 15169,
      networkName: 'Google LLC',
      networkCidr: '8.8.8.0/24',
      databaseBuildAt: '2026-07-15T00:00:00.000Z',
    })).not.toThrow();
    expect(() => insightResult.parse({ ipAddress: '8.8.8.8', ipFamily: 'ipv4', scope: 'global' })).toThrow();
    expect(() => reclassifyPayload.parse(41)).not.toThrow();
    expect(() => reclassifyPayload.parse(0)).toThrow();
    expect(() => reclassifyResult.parse({ classified: 2, unavailableRaw: 0 })).not.toThrow();
    expect(() => reclassifyResult.parse({ classified: -1, unavailableRaw: 0 })).toThrow();
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

  test('Email bulk IPC results accept failure union', () => {
    expect(() =>
      getResultSchema(IPCChannels.Email.BulkSoftDeleteMessages).parse({
        success: false,
        error: 'db locked',
      }),
    ).not.toThrow();
    expect(() =>
      getResultSchema(IPCChannels.Email.BulkSetMessagesArchived).parse({
        success: false,
        error: 'db locked',
      }),
    ).not.toThrow();
  });

  test('Email.SendCompose result accepts recoveredSentAppend', () => {
    expect(() =>
      getResultSchema(IPCChannels.Email.SendCompose).parse({
        success: true,
        recoveredSentAppend: true,
      }),
    ).not.toThrow();
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
