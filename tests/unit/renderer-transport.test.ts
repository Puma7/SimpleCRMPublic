import { AllowedInvokeChannels, IPCChannels } from '@shared/ipc/channels';
import {
  configureRendererTransportFromDeployConfig,
  createHttpRendererTransport,
  buildServerEventProtocols,
  buildServerEventWebSocketUrl,
  invokeRenderer,
  hasHttpInvocation,
  decryptServerPgpAttachment,
  isAutomationApiKeyRefreshEvent,
  isCalendarEventRefreshEvent,
  isCustomerDetailRefreshEvent,
  isCustomerListRefreshEvent,
  isDashboardRefreshEvent,
  isDealDetailRefreshEvent,
  isDealListRefreshEvent,
  isFollowUpSavedViewRefreshEvent,
  isFollowUpTimelineRefreshEvent,
  isJtlReferenceRefreshEvent,
  isMailAccountDataRefreshEvent,
  isMailAiProfileRefreshEvent,
  isMailComposeAuxDataRefreshEvent,
  isMailListRefreshEvent,
  isMailMetadataRefreshEvent,
  isMailPgpKeyRefreshEvent,
  isMailRemoteContentPolicyRefreshEvent,
  isMailSpamListRefreshEvent,
  isProductListRefreshEvent,
  isTaskListRefreshEvent,
  isWorkflowKnowledgeRefreshEvent,
  isWorkflowListRefreshEvent,
  isWorkflowVersionRefreshEvent,
  resetRendererTransportForTests,
  verifyServerPgpAttachment,
  uploadServerComposeAttachment,
} from '@/services/transport';

describe('renderer transport', () => {
  const ipcInvoke = jest.fn();

  beforeEach(() => {
    ipcInvoke.mockReset();
    resetRendererTransportForTests();
    localStorage.clear();
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { invoke: ipcInvoke },
    });
    window.sessionStorage.clear();
  });

  test('uses Electron IPC by default', async () => {
    ipcInvoke.mockResolvedValueOnce([{ id: 1, name: 'ACME' }]);

    await expect(invokeRenderer(IPCChannels.Db.GetCustomers, false)).resolves.toEqual([
      { id: 1, name: 'ACME' },
    ]);
    expect(ipcInvoke).toHaveBeenCalledWith(IPCChannels.Db.GetCustomers, false);
  });

  test('configures standalone deploy mode as IPC transport', async () => {
    const transport = configureRendererTransportFromDeployConfig({
      mode: 'standalone',
    });
    ipcInvoke.mockResolvedValueOnce({ status: 'ok' });

    expect(transport.kind).toBe('ipc');
    await expect(invokeRenderer(IPCChannels.Sync.GetStatus)).resolves.toEqual({ status: 'ok' });
    expect(ipcInvoke).toHaveBeenCalledWith(IPCChannels.Sync.GetStatus);
  });

  test('maps auth audit IPC calls to server HTTP routes', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: [{
          id: 4,
          actorUserId: 'user-a',
          action: 'auth.login_succeeded',
          entityType: 'user',
          entityId: 'user-a',
          metadata: { ip: '127.0.0.1' },
          previousHash: null,
          eventHash: 'hash-4',
          createdAt: '2026-06-04T10:00:00.000Z',
        }],
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: { valid: true, checked: 1 },
      }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Auth.ListAuditLog, {
      limit: 50,
      offset: 2,
    })).resolves.toEqual([{
      id: 4,
      user_id: 'user-a',
      action: 'auth.login_succeeded',
      resource_type: 'user',
      resource_id: 'user-a',
      detail_json: JSON.stringify({ ip: '127.0.0.1' }),
      prev_hash: null,
      row_hash: 'hash-4',
      at: '2026-06-04T10:00:00.000Z',
    }]);
    await expect(transport.invoke(IPCChannels.Auth.VerifyAuditChain, undefined)).resolves.toEqual({
      valid: true,
      checked: 1,
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/auth/audit-log?limit=50&offset=2',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/auth/audit-chain/verify',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('maps auth user admin IPC calls to server HTTP routes', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: [{
          id: 'auth-user-1',
          email: 'agent@example.com',
          displayName: 'Agent',
          role: 'user',
          disabledAt: null,
          createdAt: '2026-06-04T10:00:00.000Z',
          updatedAt: '2026-06-04T10:00:00.000Z',
        }],
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'auth-user-2',
          email: 'new-agent@example.com',
          displayName: 'New Agent',
          role: 'user',
          disabledAt: null,
        },
      }, 201))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'auth-user-2',
          email: 'renamed@example.com',
          displayName: 'Renamed',
          role: 'admin',
          disabledAt: '2026-06-04T11:00:00.000Z',
        },
      }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Auth.ListUsers, undefined)).resolves.toEqual([{
      id: 'auth-user-1',
      username: 'agent@example.com',
      display_name: 'Agent',
      role: 'agent',
      is_active: 1,
      login_pin_enabled: false,
      mfa_enabled: false,
      mfa_method: null,
      created_at: '2026-06-04T10:00:00.000Z',
      updated_at: '2026-06-04T10:00:00.000Z',
      last_login_at: null,
    }]);
    await expect(transport.invoke(IPCChannels.Auth.SaveUser, {
      username: ' NEW-AGENT@EXAMPLE.COM ',
      displayName: ' New Agent ',
      role: 'agent',
      passphrase: 'agent-passphrase',
    })).resolves.toEqual({ success: true, id: 'auth-user-2' });
    await expect(transport.invoke(IPCChannels.Auth.SaveUser, {
      id: 'auth-user-2',
      username: 'renamed@example.com',
      displayName: 'Renamed',
      role: 'admin',
      is_active: 0,
    })).resolves.toEqual({ success: true, id: 'auth-user-2' });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/auth/users',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/auth/users',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'new-agent@example.com',
          displayName: 'New Agent',
          role: 'user',
          password: 'agent-passphrase',
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      'https://crm.example.com/api/v1/auth/users/auth-user-2',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          email: 'renamed@example.com',
          displayName: 'Renamed',
          role: 'admin',
          isActive: false,
        }),
      }),
    );
  });

  test('maps automation API key IPC calls to server HTTP routes', async () => {
    const activeKey = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      label: 'n8n Bridge',
      scopes: ['read', 'email', 'unknown'],
      lastUsedAt: null,
      revokedAt: null,
      createdByUserId: 'user-1',
      secretConfigured: true,
      createdAt: '2026-06-04T10:00:00.000Z',
      updatedAt: '2026-06-04T10:00:00.000Z',
    };
    const createdKey = {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      label: 'Make Bridge',
      scopes: ['read', 'workflows'],
      lastUsedAt: null,
      revokedAt: null,
      createdByUserId: 'user-1',
      secretConfigured: true,
      createdAt: '2026-06-04T11:00:00.000Z',
      updatedAt: '2026-06-04T11:00:00.000Z',
    };
    const revokedKey = {
      ...createdKey,
      revokedAt: '2026-06-04T12:00:00.000Z',
      updatedAt: '2026-06-04T12:00:00.000Z',
    };
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: { items: [activeKey], nextCursor: null },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: { apiKey: createdKey, key: 'scrm_live_key' },
      }, 201))
      .mockResolvedValueOnce(jsonResponse({
        data: { revoked: true, apiKey: revokedKey },
      }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Automation.GetSettings, undefined)).resolves.toEqual({
      enabled: true,
      port: 0,
      bindLan: false,
      hasApiKey: true,
      keyPreview: 'n8n Bridge (aaaaaaaa)',
      scopes: ['read', 'email'],
      keys: [{
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        label: 'n8n Bridge',
        scopes: ['read', 'email'],
        lastUsedAt: null,
        revokedAt: null,
        createdByUserId: 'user-1',
        secretConfigured: true,
        createdAt: '2026-06-04T10:00:00.000Z',
        updatedAt: '2026-06-04T10:00:00.000Z',
      }],
    });
    await expect(transport.invoke(IPCChannels.Automation.GenerateApiKey, {
      label: ' Make Bridge ',
      scopes: ['read', 'workflows'],
    })).resolves.toEqual({
      success: true,
      key: 'scrm_live_key',
      scopes: ['read', 'workflows'],
      apiKey: {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        label: 'Make Bridge',
        scopes: ['read', 'workflows'],
        lastUsedAt: null,
        revokedAt: null,
        createdByUserId: 'user-1',
        secretConfigured: true,
        createdAt: '2026-06-04T11:00:00.000Z',
        updatedAt: '2026-06-04T11:00:00.000Z',
      },
    });
    await expect(transport.invoke(IPCChannels.Automation.RevokeApiKey, {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    })).resolves.toEqual({
      success: true,
      apiKey: {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        label: 'Make Bridge',
        scopes: ['read', 'workflows'],
        lastUsedAt: null,
        revokedAt: '2026-06-04T12:00:00.000Z',
        createdByUserId: 'user-1',
        secretConfigured: true,
        createdAt: '2026-06-04T11:00:00.000Z',
        updatedAt: '2026-06-04T12:00:00.000Z',
      },
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/automation/api-keys?limit=100&revoked=false',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/automation/api-keys',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          label: 'Make Bridge',
          scopes: ['read', 'workflows'],
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      'https://crm.example.com/api/v1/automation/api-keys/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  test('maps auth invite creation to server HTTP route', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({
      data: {
        invitation: {
          id: 'invite-1',
          email: 'agent@example.com',
          displayName: 'Agent',
          role: 'user',
          expiresAt: '2026-06-10T10:00:00.000Z',
          acceptedAt: null,
          revokedAt: null,
        },
        token: 'invite-token-1',
        acceptPath: '/login?invite=invite-token-1',
        delivery: {
          status: 'sent',
          recipient: 'agent@example.com',
          sentAt: '2026-06-04T12:00:00.000Z',
        },
      },
    }, 201));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Auth.CreateInvite, {
      username: ' AGENT@EXAMPLE.COM ',
      displayName: ' Agent ',
      role: 'agent',
      expiresInDays: 7,
    })).resolves.toEqual({
      success: true,
      invitation: expect.objectContaining({
        email: 'agent@example.com',
        role: 'user',
      }),
      token: 'invite-token-1',
      acceptPath: '/login?invite=invite-token-1',
      delivery: {
        status: 'sent',
        recipient: 'agent@example.com',
        sentAt: '2026-06-04T12:00:00.000Z',
      },
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/auth/invitations',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'agent@example.com',
          displayName: 'Agent',
          role: 'user',
          expiresInDays: 7,
        }),
      }),
    );
  });

  test('maps customer IPC calls to server HTTP routes', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [
            {
              id: 42,
              sourceSqliteId: 7,
              customerNumber: 'K-7',
              name: 'Meyer',
              email: 'meyer@example.com',
              zipCode: '10115',
              status: 'Lead',
              updatedAt: '2026-06-03T10:00:00.000Z',
            },
          ],
          nextCursor: 42,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [
            {
              id: 43,
              sourceSqliteId: 8,
              customerNumber: 'K-8',
              name: 'Schulz',
              email: 'schulz@example.com',
              zipCode: '50667',
              status: 'Active',
              updatedAt: '2026-06-03T11:00:00.000Z',
            },
          ],
          nextCursor: null,
        },
      }));

    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com/',
      fetchImpl,
      getAccessToken: () => 'token-1',
    });

    const result = await transport.invoke(IPCChannels.Db.GetCustomers, false);

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/customers?limit=100',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Accept: 'application/json',
          Authorization: 'Bearer token-1',
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/customers?limit=100&cursor=42',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result).toEqual([
      expect.objectContaining({
        id: 42,
        jtl_kKunde: 7,
        customerNumber: 'K-7',
        name: 'Meyer',
        email: 'meyer@example.com',
        zip: '10115',
        status: 'Lead',
      }),
      expect.objectContaining({
        id: 43,
        jtl_kKunde: 8,
        customerNumber: 'K-8',
        name: 'Schulz',
        email: 'schulz@example.com',
        zip: '50667',
        status: 'Active',
      }),
    ]);
  });

  test('maps paginated customer IPC calls without treating offsets as cursors', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [
            {
              id: 43,
              sourceSqliteId: 8,
              customerNumber: 'K-8',
              name: 'Schulz',
              email: 'schulz@example.com',
              zipCode: '50667',
              status: 'Active',
              updatedAt: '2026-06-03T11:00:00.000Z',
            },
          ],
          nextCursor: 43,
          total: 3,
        },
      }));

    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com/',
      fetchImpl,
      getAccessToken: () => 'token-1',
    });

    const result = await transport.invoke(IPCChannels.Db.GetCustomers, {
      paginated: true,
      limit: 1,
      offset: 1,
      status: 'Lead',
      sortBy: 'fullName',
      sortDirection: 'desc',
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/customers?limit=1&offset=1&status=Lead&sortBy=fullName&sortDirection=desc',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      items: [expect.objectContaining({
        id: 43,
        jtl_kKunde: 8,
        zip: '50667',
      })],
      total: 3,
    });
  });

  test('collects large paginated customer IPC calls with offset pages', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      sourceSqliteId: index + 1,
      name: `Kunde ${index + 1}`,
      status: 'Active',
    }));
    const secondPage = Array.from({ length: 20 }, (_, index) => ({
      id: index + 101,
      sourceSqliteId: index + 101,
      name: `Kunde ${index + 101}`,
      status: 'Active',
    }));
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { items: firstPage, nextCursor: 100, total: 150 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { items: secondPage, nextCursor: 120, total: 150 } }));

    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com/',
      fetchImpl,
    });

    const result = await transport.invoke(IPCChannels.Db.GetCustomers, {
      paginated: true,
      limit: 120,
      offset: 0,
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/customers?limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/customers?limit=100&offset=100',
      expect.objectContaining({ method: 'GET' }),
    );
    const pageResult = result as { items: unknown[]; total: number };
    expect(pageResult).toEqual({
      items: expect.arrayContaining([
        expect.objectContaining({ id: 1 }),
        expect.objectContaining({ id: 120 }),
      ]),
      total: 150,
    });
    expect(pageResult.items).toHaveLength(120);
  });

  test('loads custom field values for paginated customer IPC calls when requested', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [{ id: 42, sourceSqliteId: 7, name: 'Meyer', status: 'Lead' }],
          nextCursor: null,
          total: 1,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [{ id: 9, name: 'vip_status', label: 'VIP', active: true }],
          nextCursor: null,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [{ id: 99, customerId: 42, fieldId: 9, value: 'Gold' }],
          nextCursor: null,
        },
      }));

    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com/',
      fetchImpl,
    });

    const result = await transport.invoke(IPCChannels.Db.GetCustomers, {
      paginated: true,
      includeCustomFields: true,
      limit: 50,
      offset: 0,
    }) as { items: Array<{ customFields?: Record<string, string> }> };

    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/customer-custom-fields?limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      'https://crm.example.com/api/v1/customer-custom-field-values?limit=100&customerIds=42',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result.items[0].customFields).toEqual({ vip_status: 'Gold' });
  });

  test('maps customer updates with custom fields to server HTTP routes', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 42,
          sourceSqliteId: 7,
          customerNumber: 'K-7',
          name: 'Meyer GmbH',
          email: 'meyer@example.com',
          zipCode: '10115',
          status: 'Active',
          updatedAt: '2026-06-03T12:00:00.000Z',
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [{ id: 9, name: 'vip', label: 'VIP', active: true }],
          nextCursor: 9,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [{ id: 10, name: 'score', label: 'Score', active: true }],
          nextCursor: null,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({ data: { success: true } }))
      .mockResolvedValueOnce(jsonResponse({ data: { success: true } }));

    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com/',
      fetchImpl,
      getAccessToken: () => 'token-1',
    });

    const result = await transport.invoke(IPCChannels.Db.UpdateCustomer, {
      id: 42,
      customerData: {
        name: 'Meyer GmbH',
        zip: '10115',
        customFields: {
          vip: true,
          score: 7,
          unknown: 'ignored',
        },
      },
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/customers/42',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          name: 'Meyer GmbH',
          zipCode: '10115',
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/customer-custom-fields?limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      'https://crm.example.com/api/v1/customer-custom-fields?limit=100&cursor=9',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      'https://crm.example.com/api/v1/customer-custom-field-values',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ customerId: 42, fieldId: 9, value: 'true' }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      5,
      'https://crm.example.com/api/v1/customer-custom-field-values',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ customerId: 42, fieldId: 10, value: '7' }),
      }),
    );
    expect(result).toEqual({
      success: true,
      customer: expect.objectContaining({
        id: 42,
        name: 'Meyer GmbH',
        customFields: {
          vip: true,
          score: 7,
          unknown: 'ignored',
        },
      }),
    });
  });

  test('maps product list IPC calls across all server pages', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [{ id: 11, sourceSqliteId: 101, sku: 'SKU-1', name: 'Produkt 1', price: '12.50', isActive: true }],
          nextCursor: 11,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [{ id: 12, sourceSqliteId: 102, sku: 'SKU-2', name: 'Produkt 2', price: '25.00', isActive: true }],
          nextCursor: null,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [{ id: 13, sourceSqliteId: 103, sku: 'ABC-1', name: 'Suchprodukt 1', price: '9.99', isActive: true }],
          nextCursor: 13,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [{ id: 14, sourceSqliteId: 104, sku: 'ABC-2', name: 'Suchprodukt 2', price: '19.99', isActive: false }],
          nextCursor: null,
        },
      }));

    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com/',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Products.GetAll)).resolves.toEqual([
      expect.objectContaining({ id: 11, jtl_kArtikel: 101, sku: 'SKU-1', name: 'Produkt 1', price: 12.5 }),
      expect.objectContaining({ id: 12, jtl_kArtikel: 102, sku: 'SKU-2', name: 'Produkt 2', price: 25 }),
    ]);
    await expect(transport.invoke(IPCChannels.Products.Search, 'ABC')).resolves.toEqual([
      expect.objectContaining({ id: 13, jtl_kArtikel: 103, sku: 'ABC-1', name: 'Suchprodukt 1', price: 9.99 }),
      expect.objectContaining({ id: 14, jtl_kArtikel: 104, sku: 'ABC-2', name: 'Suchprodukt 2', price: 19.99 }),
    ]);

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/products?limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/products?limit=100&cursor=11',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      'https://crm.example.com/api/v1/products?limit=100&search=ABC',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      'https://crm.example.com/api/v1/products?limit=100&search=ABC&cursor=13',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('collects product search payloads above the server page limit', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [{ id: 13, sourceSqliteId: 103, sku: 'ABC-1', name: 'Suchprodukt 1', price: '9.99', isActive: true }],
          nextCursor: 13,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [{ id: 14, sourceSqliteId: 104, sku: 'ABC-2', name: 'Suchprodukt 2', price: '19.99', isActive: false }],
          nextCursor: null,
        },
      }));

    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com/',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Products.Search, { query: 'ABC', limit: 200 })).resolves.toEqual([
      expect.objectContaining({ id: 13, jtl_kArtikel: 103, sku: 'ABC-1' }),
      expect.objectContaining({ id: 14, jtl_kArtikel: 104, sku: 'ABC-2' }),
    ]);

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/products?limit=100&search=ABC',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/products?limit=100&search=ABC&cursor=13',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('maps MSSQL settings IPC calls to server HTTP routes without returning password', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          server: 'sql.local',
          database: 'JTL',
          user: 'crm',
          port: 1433,
          hasPassword: true,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: { success: true, rowCount: 1, rows: [{ ok: 1 }] },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: { success: true },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: { success: true, message: 'Password successfully cleared from secure storage.' },
      }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
      getAccessToken: () => 'token-1',
    });

    await expect(transport.invoke(IPCChannels.Mssql.GetSettings)).resolves.toEqual({
      server: 'sql.local',
      database: 'JTL',
      user: 'crm',
      port: 1433,
      hasPassword: true,
      password: undefined,
    });
    await expect(transport.invoke(IPCChannels.Mssql.TestConnection, {
      server: 'sql.local',
      database: 'JTL',
      user: 'crm',
      hasPassword: true,
    })).resolves.toMatchObject({ success: true, rowCount: 1 });
    await expect(transport.invoke(IPCChannels.Mssql.SaveSettings, {
      server: 'sql.local',
      database: 'JTL',
      user: 'crm',
      password: 'secret',
      port: 1433,
    })).resolves.toEqual({ success: true });
    await expect(transport.invoke(IPCChannels.Mssql.ClearPassword)).resolves.toMatchObject({
      success: true,
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/mssql/settings',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/mssql/test-connection',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          server: 'sql.local',
          database: 'JTL',
          user: 'crm',
          hasPassword: true,
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      'https://crm.example.com/api/v1/mssql/settings',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          server: 'sql.local',
          database: 'JTL',
          user: 'crm',
          password: 'secret',
          port: 1433,
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      'https://crm.example.com/api/v1/mssql/password',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  test('maps conversation lock IPC calls to server HTTP routes', async () => {
    const lock = {
      messageId: 42,
      userId: 'user-a',
      workspaceId: 'workspace-a',
      acquiredAt: '2026-06-04T10:00:00.000Z',
      lastHeartbeatAt: '2026-06-04T10:00:00.000Z',
      reason: 'reply',
      takeoverCount: 0,
      displayName: 'Anna',
    };
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { locks: [lock] } }))
      .mockResolvedValueOnce(jsonResponse({ data: { lock } }))
      .mockResolvedValueOnce(jsonResponse({ data: { lock } }))
      .mockResolvedValueOnce(jsonResponse({ data: { lock: { ...lock, lastHeartbeatAt: '2026-06-04T10:00:30.000Z' } } }))
      .mockResolvedValueOnce(jsonResponse({ data: { released: true, lock } }))
      .mockResolvedValueOnce(jsonResponse({ data: { lock: { ...lock, userId: 'admin-a', takeoverCount: 1 } } }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
      getAccessToken: () => 'token-1',
    });

    await expect(transport.invoke(IPCChannels.Email.ListConversationLocks, {
      messageIds: [42, 43],
    })).resolves.toEqual({ locks: [lock] });
    await expect(transport.invoke(IPCChannels.Email.GetConversationLock, 42)).resolves.toEqual({ lock });
    await expect(transport.invoke(IPCChannels.Email.AcquireConversationLock, {
      messageId: 42,
      reason: 'reply',
    })).resolves.toEqual({ lock });
    await expect(transport.invoke(IPCChannels.Email.HeartbeatConversationLock, 42)).resolves.toMatchObject({
      lock: { lastHeartbeatAt: '2026-06-04T10:00:30.000Z' },
    });
    await expect(transport.invoke(IPCChannels.Email.ReleaseConversationLock, 42)).resolves.toEqual({
      released: true,
      lock,
    });
    await expect(transport.invoke(IPCChannels.Email.TakeoverConversationLock, {
      messageId: 42,
      reason: 'edit',
    })).resolves.toMatchObject({ lock: { userId: 'admin-a', takeoverCount: 1 } });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/locks?messageIds=42%2C43',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/locks/42',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      'https://crm.example.com/api/v1/locks/42',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ reason: 'reply' }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      'https://crm.example.com/api/v1/locks/42/heartbeat',
      expect.objectContaining({ method: 'PATCH' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      5,
      'https://crm.example.com/api/v1/locks/42',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      6,
      'https://crm.example.com/api/v1/locks/42/takeover',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ reason: 'edit' }),
      }),
    );
  });

  test('builds server event WebSocket URL and access-token protocol', () => {
    expect(buildServerEventWebSocketUrl('https://crm.example.com/app/', 12)).toBe(
      'wss://crm.example.com/api/v1/events?since=12',
    );
    expect(buildServerEventWebSocketUrl('http://localhost:3000')).toBe(
      'ws://localhost:3000/api/v1/events',
    );
    expect(buildServerEventProtocols('access-token')).toEqual([
      'simplecrm.access-token.access-token',
    ]);
    expect(buildServerEventProtocols(null)).toEqual([]);
  });

  test('matches customer list refresh server events only for customer mutations', () => {
    const baseEvent = {
      type: 'customer.updated',
      workspaceId: 'workspace-a',
      entityType: 'customer',
      entityId: '21',
      occurredAt: '2026-06-04T12:00:00.000Z',
      payload: {},
    };
    expect(isCustomerListRefreshEvent(baseEvent)).toBe(true);
    expect(isCustomerListRefreshEvent({ ...baseEvent, type: 'customer.deleted' })).toBe(true);
    expect(isCustomerListRefreshEvent({ ...baseEvent, type: 'deal.updated' })).toBe(false);
    expect(isCustomerListRefreshEvent({ ...baseEvent, entityType: 'deal' })).toBe(false);
    expect(isCustomerListRefreshEvent({
      ...baseEvent,
      type: 'conversation_lock.acquired',
      entityType: 'email_message',
    })).toBe(false);
  });

  test('matches customer detail refresh server events only for the current customer', () => {
    const customerEvent = {
      type: 'customer.updated',
      workspaceId: 'workspace-a',
      entityType: 'customer',
      entityId: '21',
      occurredAt: '2026-06-04T12:00:00.000Z',
      payload: {},
    };
    const relatedDealEvent = {
      ...customerEvent,
      type: 'deal.updated',
      entityType: 'deal',
      entityId: '41',
      payload: { customerId: 21 },
    };
    const relatedTaskEvent = {
      ...customerEvent,
      type: 'task.updated',
      entityType: 'task',
      entityId: '51',
      payload: { customerId: '21' },
    };
    const relatedCustomFieldValueEvent = {
      ...customerEvent,
      type: 'custom_field_value.updated',
      entityType: 'custom_field_value',
      entityId: '71',
      payload: { customerId: 21 },
    };

    expect(isCustomerDetailRefreshEvent(customerEvent, 21)).toBe(true);
    expect(isCustomerDetailRefreshEvent({ ...customerEvent, type: 'customer.deleted' }, 21)).toBe(true);
    expect(isCustomerDetailRefreshEvent(relatedDealEvent, 21)).toBe(true);
    expect(isCustomerDetailRefreshEvent(relatedTaskEvent, 21)).toBe(true);
    expect(isCustomerDetailRefreshEvent(relatedCustomFieldValueEvent, 21)).toBe(true);
    expect(isCustomerDetailRefreshEvent({
      ...customerEvent,
      type: 'custom_field.updated',
      entityType: 'custom_field',
      entityId: '7',
    }, 21)).toBe(true);
    expect(isCustomerDetailRefreshEvent({ ...customerEvent, entityId: '22' }, 21)).toBe(false);
    expect(isCustomerDetailRefreshEvent({ ...relatedDealEvent, payload: { customerId: 22 } }, 21)).toBe(false);
    expect(isCustomerDetailRefreshEvent({ ...relatedTaskEvent, payload: {} }, 21)).toBe(false);
    expect(isCustomerDetailRefreshEvent({
      ...customerEvent,
      type: 'product.updated',
      entityType: 'product',
      entityId: '31',
    }, 21)).toBe(false);
  });

  test('matches calendar refresh server events only for calendar event mutations', () => {
    const baseEvent = {
      type: 'calendar_event.updated',
      workspaceId: 'workspace-a',
      entityType: 'calendar_event',
      entityId: '61',
      occurredAt: '2026-06-04T12:00:00.000Z',
      payload: {},
    };
    expect(isCalendarEventRefreshEvent(baseEvent)).toBe(true);
    expect(isCalendarEventRefreshEvent({ ...baseEvent, type: 'calendar_event.created' })).toBe(true);
    expect(isCalendarEventRefreshEvent({ ...baseEvent, type: 'calendar_event.deleted' })).toBe(true);
    expect(isCalendarEventRefreshEvent({ ...baseEvent, type: 'task.updated' })).toBe(false);
    expect(isCalendarEventRefreshEvent({ ...baseEvent, entityType: 'task' })).toBe(false);
    expect(isCalendarEventRefreshEvent({
      ...baseEvent,
      type: 'conversation_lock.acquired',
      entityType: 'email_message',
    })).toBe(false);
  });

  test('matches product list refresh server events only for product mutations', () => {
    const baseEvent = {
      type: 'product.updated',
      workspaceId: 'workspace-a',
      entityType: 'product',
      entityId: '31',
      occurredAt: '2026-06-04T12:00:00.000Z',
      payload: {},
    };
    expect(isProductListRefreshEvent(baseEvent)).toBe(true);
    expect(isProductListRefreshEvent({ ...baseEvent, type: 'product.created' })).toBe(true);
    expect(isProductListRefreshEvent({ ...baseEvent, type: 'product.deleted' })).toBe(true);
    expect(isProductListRefreshEvent({ ...baseEvent, type: 'deal_product.updated' })).toBe(false);
    expect(isProductListRefreshEvent({ ...baseEvent, entityType: 'deal_product' })).toBe(false);
    expect(isProductListRefreshEvent({
      ...baseEvent,
      type: 'calendar_event.updated',
      entityType: 'calendar_event',
    })).toBe(false);
  });

  test('matches deal list refresh server events for deal and deal-product mutations', () => {
    const dealEvent = {
      type: 'deal.updated',
      workspaceId: 'workspace-a',
      entityType: 'deal',
      entityId: '41',
      occurredAt: '2026-06-04T12:00:00.000Z',
      payload: {},
    };
    const dealProductEvent = {
      ...dealEvent,
      type: 'deal_product.updated',
      entityType: 'deal_product',
      entityId: '12',
      payload: { dealId: 41 },
    };

    expect(isDealListRefreshEvent(dealEvent)).toBe(true);
    expect(isDealListRefreshEvent({ ...dealEvent, type: 'deal.created' })).toBe(true);
    expect(isDealListRefreshEvent({ ...dealEvent, type: 'deal.deleted' })).toBe(true);
    expect(isDealListRefreshEvent(dealProductEvent)).toBe(true);
    expect(isDealListRefreshEvent({ ...dealProductEvent, type: 'deal_product.created' })).toBe(true);
    expect(isDealListRefreshEvent({ ...dealProductEvent, type: 'deal_product.deleted' })).toBe(true);
    expect(isDealListRefreshEvent({
      ...dealEvent,
      type: 'product.updated',
      entityType: 'product',
    })).toBe(false);
  });

  test('matches deal detail refresh server events only for the current deal', () => {
    const dealEvent = {
      type: 'deal.updated',
      workspaceId: 'workspace-a',
      entityType: 'deal',
      entityId: '41',
      occurredAt: '2026-06-04T12:00:00.000Z',
      payload: {},
    };
    const dealProductEvent = {
      ...dealEvent,
      type: 'deal_product.updated',
      entityType: 'deal_product',
      entityId: '12',
      payload: { dealId: 41 },
    };

    expect(isDealDetailRefreshEvent(dealEvent, 41)).toBe(true);
    expect(isDealDetailRefreshEvent({ ...dealEvent, type: 'deal.deleted' }, 41)).toBe(true);
    expect(isDealDetailRefreshEvent(dealProductEvent, 41)).toBe(true);
    expect(isDealDetailRefreshEvent({ ...dealProductEvent, payload: { dealId: '41' } }, 41)).toBe(true);
    expect(isDealDetailRefreshEvent({ ...dealEvent, entityId: '42' }, 41)).toBe(false);
    expect(isDealDetailRefreshEvent({ ...dealProductEvent, payload: { dealId: 42 } }, 41)).toBe(false);
    expect(isDealDetailRefreshEvent({ ...dealProductEvent, payload: {} }, 41)).toBe(false);
    expect(isDealDetailRefreshEvent({
      ...dealEvent,
      type: 'product.updated',
      entityType: 'product',
    }, 41)).toBe(false);
  });

  test('matches task list refresh server events only for task mutations', () => {
    const baseEvent = {
      type: 'task.updated',
      workspaceId: 'workspace-a',
      entityType: 'task',
      entityId: '51',
      occurredAt: '2026-06-04T12:00:00.000Z',
      payload: { customerId: 21 },
    };

    expect(isTaskListRefreshEvent(baseEvent)).toBe(true);
    expect(isTaskListRefreshEvent({ ...baseEvent, type: 'task.created' })).toBe(true);
    expect(isTaskListRefreshEvent({ ...baseEvent, type: 'task.deleted' })).toBe(true);
    expect(isTaskListRefreshEvent({ ...baseEvent, type: 'deal.updated', entityType: 'deal' })).toBe(false);
    expect(isTaskListRefreshEvent({ ...baseEvent, entityType: 'calendar_event' })).toBe(false);
    expect(isTaskListRefreshEvent({
      ...baseEvent,
      type: 'conversation_lock.acquired',
      entityType: 'email_message',
    })).toBe(false);
  });

  test('matches dashboard refresh server events for dashboard source mutations', () => {
    const baseEvent = {
      type: 'customer.updated',
      workspaceId: 'workspace-a',
      entityType: 'customer',
      entityId: '21',
      occurredAt: '2026-06-04T12:00:00.000Z',
      payload: {},
    };

    expect(isDashboardRefreshEvent(baseEvent)).toBe(true);
    expect(isDashboardRefreshEvent({ ...baseEvent, type: 'deal.updated', entityType: 'deal', entityId: '41' })).toBe(true);
    expect(isDashboardRefreshEvent({ ...baseEvent, type: 'deal_product.updated', entityType: 'deal_product', entityId: '12' })).toBe(true);
    expect(isDashboardRefreshEvent({ ...baseEvent, type: 'task.updated', entityType: 'task', entityId: '51' })).toBe(true);
    expect(isDashboardRefreshEvent({ ...baseEvent, type: 'product.updated', entityType: 'product', entityId: '31' })).toBe(false);
    expect(isDashboardRefreshEvent({
      ...baseEvent,
      type: 'calendar_event.updated',
      entityType: 'calendar_event',
      entityId: '61',
    })).toBe(false);
  });

  test('matches follow-up saved-view refresh server events only for saved-view mutations', () => {
    const baseEvent = {
      type: 'saved_view.updated',
      workspaceId: 'workspace-a',
      entityType: 'saved_view',
      entityId: '17',
      occurredAt: '2026-06-04T12:00:00.000Z',
      payload: { id: 17, name: 'Meine Ansicht' },
    };

    expect(isFollowUpSavedViewRefreshEvent(baseEvent)).toBe(true);
    expect(isFollowUpSavedViewRefreshEvent({ ...baseEvent, type: 'saved_view.created' })).toBe(true);
    expect(isFollowUpSavedViewRefreshEvent({ ...baseEvent, type: 'saved_view.deleted' })).toBe(true);
    expect(isFollowUpSavedViewRefreshEvent({ ...baseEvent, type: 'activity_log.created', entityType: 'activity_log' })).toBe(false);
    expect(isFollowUpSavedViewRefreshEvent({ ...baseEvent, entityType: 'customer' })).toBe(false);
  });

  test('matches follow-up timeline refresh server events for the current customer', () => {
    const baseEvent = {
      type: 'activity_log.created',
      workspaceId: 'workspace-a',
      entityType: 'activity_log',
      entityId: '23',
      occurredAt: '2026-06-04T12:00:00.000Z',
      payload: { id: 23, customerId: 21, title: 'Anruf' },
    };

    expect(isFollowUpTimelineRefreshEvent(baseEvent)).toBe(true);
    expect(isFollowUpTimelineRefreshEvent(baseEvent, 21)).toBe(true);
    expect(isFollowUpTimelineRefreshEvent({ ...baseEvent, payload: { customerId: '21' } }, 21)).toBe(true);
    expect(isFollowUpTimelineRefreshEvent(baseEvent, 22)).toBe(false);
    expect(isFollowUpTimelineRefreshEvent({ ...baseEvent, payload: {} }, 21)).toBe(false);
    expect(isFollowUpTimelineRefreshEvent({
      ...baseEvent,
      type: 'saved_view.created',
      entityType: 'saved_view',
      entityId: '17',
    })).toBe(false);
  });

  test('matches JTL reference refresh server events with optional resource filtering', () => {
    const baseEvent = {
      type: 'jtl_reference.updated',
      workspaceId: 'workspace-a',
      entityType: 'jtl_reference',
      entityId: 'warenlager:101',
      occurredAt: '2026-06-04T12:00:00.000Z',
      payload: { resource: 'warenlager', sourceSqliteId: 101, name: 'Lager Nord' },
    };

    expect(isJtlReferenceRefreshEvent(baseEvent)).toBe(true);
    expect(isJtlReferenceRefreshEvent({ ...baseEvent, type: 'jtl_reference.created' })).toBe(true);
    expect(isJtlReferenceRefreshEvent({ ...baseEvent, type: 'jtl_reference.deleted' })).toBe(true);
    expect(isJtlReferenceRefreshEvent(baseEvent, 'warenlager')).toBe(true);
    expect(isJtlReferenceRefreshEvent(baseEvent, 'firmen')).toBe(false);
    expect(isJtlReferenceRefreshEvent({
      ...baseEvent,
      type: 'product.updated',
      entityType: 'product',
      entityId: '31',
    })).toBe(false);
  });

  test('matches mail list refresh server events for message list mutations', () => {
    const baseEvent = {
      type: 'email_message.updated',
      workspaceId: 'workspace-a',
      entityType: 'email_message',
      entityId: '91',
      occurredAt: '2026-06-04T12:00:00.000Z',
      payload: { messageId: 91 },
    };

    expect(isMailListRefreshEvent(baseEvent)).toBe(true);
    expect(isMailListRefreshEvent({
      ...baseEvent,
      type: 'email_message_tag.created',
      entityType: 'email_message_tag',
      entityId: '15',
    })).toBe(true);
    expect(isMailListRefreshEvent({
      ...baseEvent,
      type: 'email_message_category.deleted',
      entityType: 'email_message_category',
      entityId: '16',
    })).toBe(true);
    expect(isMailListRefreshEvent({
      ...baseEvent,
      type: 'email_category.updated',
      entityType: 'email_category',
      entityId: '4',
    })).toBe(true);
    expect(isMailListRefreshEvent({
      ...baseEvent,
      type: 'email_read_receipt.created',
      entityType: 'email_read_receipt',
      entityId: '5',
    })).toBe(true);
    expect(isMailListRefreshEvent({
      ...baseEvent,
      type: 'email_thread_alias.updated',
      entityType: 'email_thread_alias',
      entityId: '7',
    })).toBe(true);
    expect(isMailListRefreshEvent({
      ...baseEvent,
      type: 'email_thread_edge.created',
      entityType: 'email_thread_edge',
      entityId: '8',
    })).toBe(true);
    expect(isMailListRefreshEvent({
      ...baseEvent,
      type: 'email_thread.updated',
      entityType: 'email_thread',
      entityId: 'ticket-1',
    })).toBe(true);
    expect(isMailListRefreshEvent({
      ...baseEvent,
      type: 'email_internal_note.created',
      entityType: 'email_internal_note',
      entityId: '18',
    })).toBe(false);
    expect(isMailListRefreshEvent({
      ...baseEvent,
      type: 'email_message.updated',
      entityType: 'email_internal_note',
      entityId: '18',
    })).toBe(false);
  });

  test('matches mail metadata refresh server events for selected-message metadata mutations', () => {
    const baseEvent = {
      type: 'email_internal_note.updated',
      workspaceId: 'workspace-a',
      entityType: 'email_internal_note',
      entityId: '18',
      occurredAt: '2026-06-04T12:00:00.000Z',
      payload: { messageId: 91 },
    };

    expect(isMailMetadataRefreshEvent(baseEvent)).toBe(true);
    expect(isMailMetadataRefreshEvent({
      ...baseEvent,
      type: 'email_message_tag.deleted',
      entityType: 'email_message_tag',
      entityId: '15',
    })).toBe(true);
    expect(isMailMetadataRefreshEvent({
      ...baseEvent,
      type: 'email_message_category.created',
      entityType: 'email_message_category',
      entityId: '16',
    })).toBe(true);
    expect(isMailMetadataRefreshEvent({
      ...baseEvent,
      type: 'email_canned_response.updated',
      entityType: 'email_canned_response',
      entityId: '22',
    })).toBe(false);
    expect(isMailMetadataRefreshEvent({
      ...baseEvent,
      type: 'email_internal_note.updated',
      entityType: 'email_message',
      entityId: '91',
    })).toBe(false);
  });

  test('matches remote content policy refresh server events for message and allowlist mutations', () => {
    const baseEvent = {
      type: 'email_remote_content_allowlist.updated',
      workspaceId: 'workspace-a',
      entityType: 'email_remote_content_allowlist',
      entityId: '18',
      occurredAt: '2026-06-04T12:00:00.000Z',
      payload: { scope: 'domain', value: 'images.example.com' },
    };

    expect(isMailRemoteContentPolicyRefreshEvent(baseEvent)).toBe(true);
    expect(isMailRemoteContentPolicyRefreshEvent({
      ...baseEvent,
      type: 'email_remote_content_allowlist.created',
    })).toBe(true);
    expect(isMailRemoteContentPolicyRefreshEvent({
      ...baseEvent,
      type: 'email_remote_content_allowlist.deleted',
    })).toBe(true);
    expect(isMailRemoteContentPolicyRefreshEvent({
      ...baseEvent,
      type: 'email_message.updated',
      entityType: 'email_message',
      entityId: '91',
    })).toBe(true);
    expect(isMailRemoteContentPolicyRefreshEvent({
      ...baseEvent,
      type: 'email_remote_content_allowlist.updated',
      entityType: 'email_message',
      entityId: '91',
    })).toBe(false);
    expect(isMailRemoteContentPolicyRefreshEvent({
      ...baseEvent,
      type: 'email_internal_note.updated',
      entityType: 'email_internal_note',
      entityId: '19',
    })).toBe(false);
  });

  test('matches mail spam list refresh server events for spam list entry mutations', () => {
    const baseEvent = {
      type: 'spam_list_entry.updated',
      workspaceId: 'workspace-a',
      entityType: 'spam_list_entry',
      entityId: '18',
      occurredAt: '2026-06-04T12:00:00.000Z',
      payload: { pattern: 'blocked.example.com' },
    };

    expect(isMailSpamListRefreshEvent(baseEvent)).toBe(true);
    expect(isMailSpamListRefreshEvent({
      ...baseEvent,
      type: 'spam_list_entry.created',
    })).toBe(true);
    expect(isMailSpamListRefreshEvent({
      ...baseEvent,
      type: 'spam_list_entry.deleted',
    })).toBe(true);
    expect(isMailSpamListRefreshEvent({
      ...baseEvent,
      type: 'spam_learning_event.created',
      entityType: 'spam_learning_event',
    })).toBe(false);
    expect(isMailSpamListRefreshEvent({
      ...baseEvent,
      type: 'spam_list_entry.updated',
      entityType: 'email_message',
    })).toBe(false);
  });

  test('matches workflow list refresh server events for workflow mutations', () => {
    const baseEvent = {
      type: 'workflow.updated',
      workspaceId: 'workspace-a',
      entityType: 'workflow',
      entityId: '8',
      occurredAt: '2026-06-04T12:00:00.000Z',
      payload: { id: 8, name: 'Inbound triage' },
    };

    expect(isWorkflowListRefreshEvent(baseEvent)).toBe(true);
    expect(isWorkflowListRefreshEvent({ ...baseEvent, type: 'workflow.created' })).toBe(true);
    expect(isWorkflowListRefreshEvent({ ...baseEvent, type: 'workflow.deleted' })).toBe(true);
    expect(isWorkflowListRefreshEvent({
      ...baseEvent,
      type: 'workflow_version.created',
      entityType: 'workflow_version',
    })).toBe(false);
    expect(isWorkflowListRefreshEvent({
      ...baseEvent,
      type: 'workflow.updated',
      entityType: 'workflow_version',
    })).toBe(false);
  });

  test('matches workflow version refresh server events for the current workflow', () => {
    const baseEvent = {
      type: 'workflow_version.created',
      workspaceId: 'workspace-a',
      entityType: 'workflow_version',
      entityId: '24',
      occurredAt: '2026-06-04T12:00:00.000Z',
      payload: { workflowId: 8, label: 'Snapshot' },
    };

    expect(isWorkflowVersionRefreshEvent(baseEvent)).toBe(true);
    expect(isWorkflowVersionRefreshEvent(baseEvent, 8)).toBe(true);
    expect(isWorkflowVersionRefreshEvent({ ...baseEvent, type: 'workflow_version.updated' }, 8)).toBe(true);
    expect(isWorkflowVersionRefreshEvent({ ...baseEvent, type: 'workflow_version.deleted' }, 8)).toBe(true);
    expect(isWorkflowVersionRefreshEvent({ ...baseEvent, payload: { workflowId: '8' } }, 8)).toBe(true);
    expect(isWorkflowVersionRefreshEvent(baseEvent, 9)).toBe(false);
    expect(isWorkflowVersionRefreshEvent({ ...baseEvent, payload: {} }, 8)).toBe(false);
    expect(isWorkflowVersionRefreshEvent({
      ...baseEvent,
      type: 'workflow.updated',
      entityType: 'workflow',
      entityId: '8',
    }, 8)).toBe(false);
  });

  test('matches workflow knowledge refresh server events for base and chunk mutations', () => {
    const baseEvent = {
      type: 'workflow_knowledge_base.updated',
      workspaceId: 'workspace-a',
      entityType: 'workflow_knowledge_base',
      entityId: '12',
      occurredAt: '2026-06-04T12:00:00.000Z',
      payload: { id: 12, name: 'Returns' },
    };
    const chunkEvent = {
      ...baseEvent,
      type: 'workflow_knowledge_chunk.updated',
      entityType: 'workflow_knowledge_chunk',
      entityId: '44',
      payload: { id: 44, knowledgeBaseId: 12, title: 'Policy' },
    };

    expect(isWorkflowKnowledgeRefreshEvent(baseEvent)).toBe(true);
    expect(isWorkflowKnowledgeRefreshEvent({ ...baseEvent, type: 'workflow_knowledge_base.created' })).toBe(true);
    expect(isWorkflowKnowledgeRefreshEvent({ ...baseEvent, type: 'workflow_knowledge_base.deleted' }, 12)).toBe(true);
    expect(isWorkflowKnowledgeRefreshEvent(baseEvent, 13)).toBe(false);
    expect(isWorkflowKnowledgeRefreshEvent(chunkEvent)).toBe(true);
    expect(isWorkflowKnowledgeRefreshEvent(chunkEvent, 12)).toBe(true);
    expect(isWorkflowKnowledgeRefreshEvent({ ...chunkEvent, type: 'workflow_knowledge_chunk.created' }, 12)).toBe(true);
    expect(isWorkflowKnowledgeRefreshEvent({ ...chunkEvent, type: 'workflow_knowledge_chunk.deleted' }, 12)).toBe(true);
    expect(isWorkflowKnowledgeRefreshEvent({ ...chunkEvent, payload: { knowledgeBaseId: '12' } }, 12)).toBe(true);
    expect(isWorkflowKnowledgeRefreshEvent(chunkEvent, 13)).toBe(false);
    expect(isWorkflowKnowledgeRefreshEvent({
      ...baseEvent,
      type: 'workflow.updated',
      entityType: 'workflow',
    })).toBe(false);
  });

  test('matches mail account data refresh server events for account, team, and signature mutations', () => {
    const baseEvent = {
      type: 'email_account.updated',
      workspaceId: 'workspace-a',
      entityType: 'email_account',
      entityId: '3',
      occurredAt: '2026-06-04T12:00:00.000Z',
      payload: { id: 3 },
    };

    expect(isMailAccountDataRefreshEvent(baseEvent)).toBe(true);
    expect(isMailAccountDataRefreshEvent({
      ...baseEvent,
      type: 'email_team_member.deleted',
      entityType: 'email_team_member',
      entityId: 'support',
    })).toBe(true);
    expect(isMailAccountDataRefreshEvent({
      ...baseEvent,
      type: 'email_account_signature.created',
      entityType: 'email_account_signature',
      entityId: '-2',
    })).toBe(true);
    expect(isMailAccountDataRefreshEvent({
      ...baseEvent,
      type: 'email_canned_response.updated',
      entityType: 'email_canned_response',
      entityId: '9',
    })).toBe(false);
    expect(isMailAccountDataRefreshEvent({
      ...baseEvent,
      type: 'email_account.updated',
      entityType: 'email_account_signature',
      entityId: '-2',
    })).toBe(false);
  });

  test('matches mail compose auxiliary data refresh server events for canned responses and prompts', () => {
    const baseEvent = {
      type: 'email_canned_response.updated',
      workspaceId: 'workspace-a',
      entityType: 'email_canned_response',
      entityId: '9',
      occurredAt: '2026-06-04T12:00:00.000Z',
      payload: { id: 9 },
    };

    expect(isMailComposeAuxDataRefreshEvent(baseEvent)).toBe(true);
    expect(isMailComposeAuxDataRefreshEvent({
      ...baseEvent,
      type: 'ai_prompt.deleted',
      entityType: 'ai_prompt',
      entityId: '11',
    })).toBe(true);
    expect(isMailComposeAuxDataRefreshEvent({
      ...baseEvent,
      type: 'email_account_signature.updated',
      entityType: 'email_account_signature',
      entityId: '-2',
    })).toBe(false);
    expect(isMailComposeAuxDataRefreshEvent({
      ...baseEvent,
      type: 'email_canned_response.updated',
      entityType: 'ai_prompt',
      entityId: '11',
    })).toBe(false);
  });

  test('matches server-client settings refresh events for AI profiles, PGP keys, and automation keys', () => {
    const baseEvent = {
      type: 'ai_profile.updated',
      workspaceId: 'workspace-a',
      entityType: 'ai_profile',
      entityId: '21',
      occurredAt: '2026-06-04T12:00:00.000Z',
      payload: { id: 21 },
    };

    expect(isMailAiProfileRefreshEvent(baseEvent)).toBe(true);
    expect(isMailAiProfileRefreshEvent({
      ...baseEvent,
      type: 'ai_prompt.updated',
      entityType: 'ai_prompt',
      entityId: '11',
    })).toBe(false);

    expect(isMailPgpKeyRefreshEvent({
      ...baseEvent,
      type: 'pgp_identity.deleted',
      entityType: 'pgp_identity',
      entityId: '41',
    })).toBe(true);
    expect(isMailPgpKeyRefreshEvent({
      ...baseEvent,
      type: 'pgp_peer_key.updated',
      entityType: 'pgp_peer_key',
      entityId: '42',
    })).toBe(true);
    expect(isMailPgpKeyRefreshEvent({
      ...baseEvent,
      type: 'pgp_identity.updated',
      entityType: 'pgp_peer_key',
      entityId: '42',
    })).toBe(false);

    expect(isAutomationApiKeyRefreshEvent({
      ...baseEvent,
      type: 'automation_api_key.created',
      entityType: 'automation_api_key',
      entityId: 'api-key-a',
    })).toBe(true);
    expect(isAutomationApiKeyRefreshEvent({
      ...baseEvent,
      type: 'automation_api_key.updated',
      entityType: 'automation_api_key',
      entityId: 'api-key-a',
    })).toBe(false);
  });

  test('maps single customer lookup to server HTTP route', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({
      data: {
        id: 42,
        sourceSqliteId: 7,
        customerNumber: 'K-7',
        name: 'Meyer',
        firstName: 'Anna',
        company: 'Meyer GmbH',
        email: 'meyer@example.com',
        zipCode: '10115',
        status: 'Lead',
        updatedAt: '2026-06-03T10:00:00.000Z',
      },
    }));

    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
      getAccessToken: () => 'token-1',
    });

    await expect(transport.invoke(IPCChannels.Db.GetCustomer, 42)).resolves.toEqual(
      expect.objectContaining({
        id: 42,
        jtl_kKunde: 7,
        customerNumber: 'K-7',
        name: 'Meyer',
        firstName: 'Anna',
        company: 'Meyer GmbH',
        email: 'meyer@example.com',
        zip: '10115',
        status: 'Lead',
        lastModifiedLocally: '2026-06-03T10:00:00.000Z',
      }),
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/customers/42',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Accept: 'application/json',
          Authorization: 'Bearer token-1',
        }),
      }),
    );
  });

  test('maps task mutations to server requests and legacy success response', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 9,
          customerId: 4,
          title: 'Call',
          dueDate: '2026-06-04T00:00:00.000Z',
          priority: 'High',
          completed: true,
          updatedAt: '2026-06-03T10:00:00.000Z',
        },
      }))
      .mockResolvedValueOnce(jsonResponse({ data: { success: true } }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    const result = await transport.invoke(IPCChannels.Tasks.Update, {
      id: 9,
      taskData: {
        title: 'Call',
        due_date: '2026-06-04',
        completed: 1,
      },
    });

    await expect(transport.invoke(IPCChannels.Tasks.ToggleCompletion, {
      taskId: 9,
      completed: false,
    })).resolves.toEqual({ success: true });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/tasks/9',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          title: 'Call',
          dueDate: '2026-06-04',
          completed: true,
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/tasks/9/toggle',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ completed: false }),
      }),
    );
    expect(result).toEqual({
      success: true,
      task: expect.objectContaining({
        id: 9,
        customer_id: 4,
        due_date: '2026-06-04T00:00:00.000Z',
        completed: true,
      }),
    });
  });

  test('maps deal channels to server HTTP routes and legacy shapes', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [
            {
              id: 4,
              sourceSqliteId: 40,
              customerSourceSqliteId: 20,
              customerId: 2,
              name: 'Renewal',
              value: '1200.00',
              valueCalculationMethod: 'static',
              stage: 'Angebot',
              notes: 'Next step',
              createdDate: '2026-06-01T00:00:00.000Z',
              expectedCloseDate: '2026-12-31T00:00:00.000Z',
              updatedAt: '2026-06-03T10:00:00.000Z',
            },
          ],
          nextCursor: null,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 5,
          customerId: 2,
          name: 'New Deal',
          value: '4500',
          valueCalculationMethod: 'dynamic',
          stage: 'Interessent',
          notes: null,
          createdDate: '2026-06-03T10:00:00.000Z',
          expectedCloseDate: '2026-12-31T00:00:00.000Z',
          updatedAt: '2026-06-03T10:00:00.000Z',
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 5,
          customerId: 2,
          name: 'New Deal',
          value: '4500',
          valueCalculationMethod: 'dynamic',
          stage: 'Gewonnen',
          notes: null,
          createdDate: '2026-06-03T10:00:00.000Z',
          expectedCloseDate: '2026-12-31T00:00:00.000Z',
          updatedAt: '2026-06-03T10:05:00.000Z',
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: { deleted: true },
      }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Deals.GetAll, {
      limit: 10000,
      offset: 0,
      filter: { query: 'Renewal', stage: 'Angebot', customer_id: 2 },
    })).resolves.toEqual([
      expect.objectContaining({
        id: 4,
        source_sqlite_id: 40,
        customer_source_sqlite_id: 20,
        customer_id: 2,
        customer: '',
        customer_name: '',
        name: 'Renewal',
        value: '1200.00',
        valueCalculationMethod: 'static',
        value_calculation_method: 'static',
        stage: 'Angebot',
        created_date: '2026-06-01T00:00:00.000Z',
        expected_close_date: '2026-12-31T00:00:00.000Z',
      }),
    ]);
    await expect(transport.invoke(IPCChannels.Deals.Create, {
      customer_id: 2,
      name: 'New Deal',
      value: 4500,
      value_calculation_method: 'dynamic',
      stage: 'Interessent',
      expected_close_date: '31.12.2026',
    })).resolves.toMatchObject({
      success: true,
      id: 5,
      deal: {
        id: 5,
        value: '4500',
        value_calculation_method: 'dynamic',
      },
    });
    await expect(transport.invoke(IPCChannels.Deals.UpdateStage, {
      dealId: 5,
      newStage: 'Gewonnen',
    })).resolves.toMatchObject({
      success: true,
      deal: {
        id: 5,
        stage: 'Gewonnen',
      },
    });
    await expect(transport.invoke(IPCChannels.Deals.Delete, 5)).resolves.toEqual({ success: true });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/deals?limit=100&search=Renewal&stage=Angebot&customerId=2',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/deals',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          customerId: 2,
          name: 'New Deal',
          value: '4500',
          valueCalculationMethod: 'dynamic',
          stage: 'Interessent',
          expectedCloseDate: '2026-12-31',
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      'https://crm.example.com/api/v1/deals/5/stage',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ stage: 'Gewonnen' }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      'https://crm.example.com/api/v1/deals/5',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  test('maps JTL reference channels to server HTTP routes and legacy keys', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { items: [{ sourceSqliteId: 1, name: 'Firma A' }] } }))
      .mockResolvedValueOnce(jsonResponse({ data: { items: [{ sourceSqliteId: 2, name: 'Lager B' }] } }))
      .mockResolvedValueOnce(jsonResponse({ data: { items: [{ sourceSqliteId: 3, name: 'Rechnung' }] } }))
      .mockResolvedValueOnce(jsonResponse({ data: { items: [{ sourceSqliteId: 4, name: 'DHL' }] } }))
      .mockResolvedValueOnce(jsonResponse({ data: { success: true, jtlOrderId: 123, jtlOrderNumber: 'EXTERN-1' } }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Jtl.GetFirmen)).resolves.toEqual([
      { kFirma: 1, cName: 'Firma A' },
    ]);
    await expect(transport.invoke(IPCChannels.Jtl.GetWarenlager)).resolves.toEqual([
      { kWarenlager: 2, cName: 'Lager B' },
    ]);
    await expect(transport.invoke(IPCChannels.Jtl.GetZahlungsarten)).resolves.toEqual([
      { kZahlungsart: 3, cName: 'Rechnung' },
    ]);
    await expect(transport.invoke(IPCChannels.Jtl.GetVersandarten)).resolves.toEqual([
      { kVersandart: 4, cName: 'DHL' },
    ]);
    await expect(transport.invoke(IPCChannels.Jtl.CreateOrder, {
      simpleCrmCustomerId: '9',
      cFirma: 'Legacy ignored',
      kFirma: '1',
      kWarenlager: 2,
      kZahlungsart: '3',
      kVersandart: 4,
      products: [
        {
          kArtikel: '900',
          cName: 'Artikel A',
          cArtNr: 'SKU-A',
          nAnzahl: '2.5',
          fPreis: '19.99',
          ignored: true,
        },
      ],
    })).resolves.toEqual({ success: true, jtlOrderId: 123, jtlOrderNumber: 'EXTERN-1' });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/jtl/firmen?limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/jtl/warenlager?limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      'https://crm.example.com/api/v1/jtl/zahlungsarten?limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      'https://crm.example.com/api/v1/jtl/versandarten?limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      5,
      'https://crm.example.com/api/v1/jtl/orders',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          simpleCrmCustomerId: 9,
          kFirma: 1,
          kWarenlager: 2,
          kZahlungsart: 3,
          kVersandart: 4,
          products: [{
            kArtikel: 900,
            cName: 'Artikel A',
            cArtNr: 'SKU-A',
            nAnzahl: 2.5,
            fPreis: 19.99,
          }],
        }),
      }),
    );
  });

  test('maps deal task channel to server HTTP route', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({
      data: {
        items: [
          {
            id: 9,
            customerId: 2,
            title: 'Follow up',
            dueDate: '2026-06-04T00:00:00.000Z',
            priority: 'High',
            completed: false,
            updatedAt: '2026-06-03T10:00:00.000Z',
          },
        ],
        nextCursor: null,
      },
    }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Deals.GetTasks, 4)).resolves.toEqual([
      expect.objectContaining({
        id: 9,
        customer_id: 2,
        title: 'Follow up',
        due_date: '2026-06-04T00:00:00.000Z',
        priority: 'High',
        completed: false,
      }),
    ]);

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/deals/4/tasks?limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('maps deal product channels to server HTTP routes and legacy shape', async () => {
    const linkRecord = {
      id: 12,
      dealId: 4,
      productId: 9,
      quantity: 2,
      priceAtTimeOfAdding: '19.50',
      dateAdded: '2026-06-03T10:00:00.000Z',
      product: {
        id: 9,
        sourceSqliteId: -9,
        jtlKartikel: 900,
        name: 'Support Plan',
        sku: 'SUPPORT',
        description: null,
        price: '20.00',
        isActive: true,
        updatedAt: '2026-06-03T09:00:00.000Z',
      },
    };
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: [linkRecord] }))
      .mockResolvedValueOnce(jsonResponse({ data: linkRecord }))
      .mockResolvedValueOnce(jsonResponse({ data: { ...linkRecord, quantity: 3, priceAtTimeOfAdding: '21.00' } }))
      .mockResolvedValueOnce(jsonResponse({ data: { deleted: true, dealProduct: linkRecord } }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Deals.GetProducts, 4)).resolves.toEqual([
      expect.objectContaining({
        id: 9,
        deal_product_id: 12,
        deal_id: 4,
        product_id: 9,
        quantity: 2,
        price_at_time_of_adding: 19.5,
        name: 'Support Plan',
      }),
    ]);
    await expect(transport.invoke(IPCChannels.Deals.AddProduct, {
      dealId: 4,
      productId: 9,
      quantity: 2,
      price: 19.5,
    })).resolves.toMatchObject({
      success: true,
      lastInsertRowid: 12,
    });
    await expect(transport.invoke(IPCChannels.Deals.UpdateProduct, {
      dealProductId: 12,
      quantity: 3,
      priceAtTime: 21,
    })).resolves.toMatchObject({
      success: true,
      changes: 1,
      dealProduct: {
        deal_product_id: 12,
        quantity: 3,
        price_at_time_of_adding: 21,
      },
    });
    await expect(transport.invoke(IPCChannels.Deals.RemoveProduct, {
      dealId: 4,
      productId: 9,
    })).resolves.toEqual({ success: true, changes: 1 });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/deals/4/products',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/deals/4/products',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          productId: 9,
          quantity: 2,
          price: 19.5,
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      'https://crm.example.com/api/v1/deal-products/12',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          quantity: 3,
          price: 21,
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      'https://crm.example.com/api/v1/deals/4/products/by-product/9',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  test('maps custom field value delete channel to customer/field HTTP route', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({
      data: {
        deleted: true,
        customFieldValue: {
          id: 62,
          customerId: 7,
          fieldId: 3,
          value: 'Gold',
        },
      },
    }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.CustomFields.DeleteValue, {
      customerId: 7,
      fieldId: 3,
    })).resolves.toEqual({ success: true });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/customers/7/custom-field-values/3',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  test('maps email category CRUD channels to server metadata HTTP routes', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [
            {
              id: 61,
              sourceSqliteId: -61,
              parentId: null,
              name: 'Support',
              sortOrder: 2,
              updatedAt: '2026-06-03T10:00:00.000Z',
            },
          ],
          nextCursor: null,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: { id: 62, parentId: null, name: 'VIP', sortOrder: 0 },
      }, 201))
      .mockResolvedValueOnce(jsonResponse({
        data: { id: 61, parentId: null, name: 'Support updated', sortOrder: 2 },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: { deleted: true, category: { id: 61 } },
      }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.ListCategories)).resolves.toEqual([
      {
        id: 61,
        source_sqlite_id: -61,
        parent_source_sqlite_id: undefined,
        parent_id: null,
        name: 'Support',
        sort_order: 2,
        created_at: undefined,
        updated_at: '2026-06-03T10:00:00.000Z',
      },
    ]);
    await expect(transport.invoke(IPCChannels.Email.CreateCategory, {
      name: 'VIP',
      parentId: null,
    })).resolves.toEqual({ success: true, id: 62 });
    await expect(transport.invoke(IPCChannels.Email.UpdateCategory, {
      categoryId: 61,
      name: 'Support updated',
      parentId: null,
      sortOrder: 3,
    })).resolves.toEqual({ success: true });
    await expect(transport.invoke(IPCChannels.Email.DeleteCategory, 61)).resolves.toEqual({
      success: true,
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/email/categories?limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/email/categories',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'VIP', parentId: null }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      'https://crm.example.com/api/v1/email/categories/61',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          name: 'Support updated',
          parentId: null,
          sortOrder: 3,
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      'https://crm.example.com/api/v1/email/categories/61',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  test('maps email category count channel to server metadata HTTP route', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        data: [
          { categoryId: 61, count: 3 },
          { categoryId: 62, count: 0 },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: [
          { categoryId: 63, count: 7 },
        ],
      }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.CategoryCounts, 101)).resolves.toEqual([
      { categoryId: 61, count: 3 },
      { categoryId: 62, count: 0 },
    ]);
    await expect(transport.invoke(IPCChannels.Email.CategoryCounts, 'all')).resolves.toEqual([
      { categoryId: 63, count: 7 },
    ]);

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/email/category-counts?accountId=101',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/email/category-counts',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('maps email category reorder channel to server category bulk reorder', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          success: true,
          items: [
            { id: 61, parentId: null, name: 'Support', sortOrder: 0 },
            { id: 62, parentId: 61, name: 'VIP', sortOrder: 0 },
          ],
        },
      }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.ReorderCategories, {
      updates: [
        { id: 61, parentId: null, sortOrder: 0 },
        { id: 62, parentId: 61, sortOrder: 0 },
      ],
    })).resolves.toEqual({ success: true });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/email/categories/reorder',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          updates: [
            { id: 61, parentId: null, sortOrder: 0 },
            { id: 62, parentId: 61, sortOrder: 0 },
          ],
        }),
      }),
    );
  });

  test('maps email account list channel to server mail route', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({
      data: {
        items: [
          {
            id: 101,
            sourceSqliteId: 1,
            displayName: 'Shop 1',
            emailAddress: 'shop1@example.com',
            protocol: 'imap',
            imapHost: 'imap.example.com',
            imapPort: 993,
            imapTls: true,
            imapUsername: 'shop1@example.com',
            smtpHost: 'smtp.example.com',
            smtpPort: 587,
            smtpTls: true,
            smtpUsername: 'shop1@example.com',
            smtpUseImapAuth: false,
            pop3Host: null,
            pop3Port: null,
            pop3Tls: true,
            sentFolderPath: 'Sent',
            syncSpamFolderPath: 'Spam',
            syncArchiveFolderPath: 'Archive',
            imapSyncSent: true,
            imapSyncArchive: false,
            imapSyncSpam: true,
            imapSyncSeenOnOpen: false,
            vacationEnabled: true,
            vacationSubject: 'Away',
            vacationBodyText: 'Back later',
            requestReadReceipt: true,
            updatedAt: '2026-06-03T10:00:00.000Z',
          },
        ],
      },
    }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.ListAccounts)).resolves.toEqual([
      expect.objectContaining({
        id: 1,
        source_sqlite_id: 1,
        display_name: 'Shop 1',
        email_address: 'shop1@example.com',
        protocol: 'imap',
        imap_host: 'imap.example.com',
        imap_port: 993,
        imap_tls: 1,
        smtp_host: 'smtp.example.com',
        smtp_port: 587,
        smtp_tls: 1,
        smtp_use_imap_auth: 0,
        sync_spam_folder_path: 'Spam',
        sync_archive_folder_path: 'Archive',
        imap_sync_sent: 1,
        imap_sync_archive: 0,
        imap_sync_spam: 1,
        imap_sync_seen_on_open: 0,
        vacation_enabled: 1,
        vacation_subject: 'Away',
        vacation_body_text: 'Back later',
        request_read_receipt: 1,
        updated_at: '2026-06-03T10:00:00.000Z',
      }),
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/email/accounts',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('maps email account create, update, and delete channels to server routes', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { success: true, id: 9 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { success: true } }))
      .mockResolvedValueOnce(jsonResponse({ data: { success: true, deleted: true } }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.CreateAccount, {
      displayName: ' Shop account ',
      emailAddress: 'shop@example.com',
      imapHost: 'imap.example.com',
      imapPort: 993,
      imapTls: true,
      imapUsername: 'shop@example.com',
      imapPassword: 'imap-secret',
      protocol: 'pop3',
      pop3Host: ' pop3.example.com ',
      pop3Port: 995,
      pop3Tls: false,
      imapSyncSeenOnOpen: false,
    })).resolves.toEqual({ success: true, id: 9 });
    await expect(transport.invoke(IPCChannels.Email.UpdateAccount, {
      id: 1,
      displayName: ' Shop account ',
      emailAddress: 'shop@example.com',
      imapHost: 'imap.example.com',
      imapPort: 993,
      imapTls: true,
      imapUsername: 'shop@example.com',
      imapPassword: 'imap-secret',
      smtpHost: ' ',
      smtpPort: 587,
      smtpTls: false,
      smtpUsername: null,
      smtpUseImapAuth: true,
      smtpPassword: 'smtp-secret',
      protocol: 'imap',
      sentFolderPath: ' Sent ',
      syncSpamFolderPath: ' Spam ',
      syncArchiveFolderPath: ' ',
      imapSyncSent: true,
      imapSyncArchive: false,
      imapSyncSpam: true,
      imapSyncSeenOnOpen: false,
      vacationEnabled: true,
      vacationSubject: ' Away ',
      vacationBodyText: ' Back later ',
      requestReadReceipt: true,
    })).resolves.toEqual({ success: true });
    await expect(transport.invoke(IPCChannels.Email.DeleteAccount, 1)).resolves.toEqual({ success: true });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/email/accounts',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          displayName: 'Shop account',
          emailAddress: 'shop@example.com',
          imapHost: 'imap.example.com',
          imapPort: 993,
          imapTls: true,
          imapUsername: 'shop@example.com',
          imapPassword: 'imap-secret',
          protocol: 'pop3',
          pop3Host: 'pop3.example.com',
          pop3Port: 995,
          pop3Tls: false,
          imapSyncSeenOnOpen: false,
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/email/accounts/1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          displayName: 'Shop account',
          emailAddress: 'shop@example.com',
          imapHost: 'imap.example.com',
          imapPort: 993,
          imapTls: true,
          imapUsername: 'shop@example.com',
          imapPassword: 'imap-secret',
          smtpHost: null,
          smtpPort: 587,
          smtpTls: false,
          smtpUsername: null,
          smtpUseImapAuth: true,
          smtpPassword: 'smtp-secret',
          protocol: 'imap',
          sentFolderPath: 'Sent',
          syncSpamFolderPath: 'Spam',
          syncArchiveFolderPath: null,
          imapSyncSent: true,
          imapSyncArchive: false,
          imapSyncSpam: true,
          imapSyncSeenOnOpen: false,
          vacationEnabled: true,
          vacationSubject: 'Away',
          vacationBodyText: 'Back later',
          requestReadReceipt: true,
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      'https://crm.example.com/api/v1/email/accounts/1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  test('maps email account sync actions to server routes', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          success: true,
          queued: true,
          accountId: 7,
          jobType: 'mail.sync.imap',
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          success: true,
          accountId: 7,
          released: 1,
        },
      }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.SyncAccount, 7)).resolves.toEqual({
      success: true,
      fetched: 0,
      queued: true,
      accountId: 7,
      jobType: 'mail.sync.imap',
    });
    await expect(transport.invoke(IPCChannels.Email.ClearAccountSyncLock, 7)).resolves.toEqual({
      success: true,
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/email/accounts/7/sync',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/email/accounts/7/sync-lock',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  test('maps inbox archive recovery to server account recovery routes', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          success: true,
          accountId: 7,
          count: 3,
          accountEmail: 'support@example.com',
          accountLabel: 'Support',
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          success: true,
          restored: 3,
        },
      }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.PreviewRestoreInboxFromArchive, 7)).resolves.toEqual({
      success: true,
      accountId: 7,
      count: 3,
      accountEmail: 'support@example.com',
      accountLabel: 'Support',
    });
    await expect(transport.invoke(IPCChannels.Email.RestoreInboxFromArchive, {
      accountId: 7,
      expectedCount: 3,
      confirmPhrase: 'support@example.com',
    })).resolves.toEqual({
      success: true,
      restored: 3,
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/email/accounts/7/inbox-archive-recovery',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/email/accounts/7/inbox-archive-recovery',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          expectedCount: 3,
          confirmPhrase: 'support@example.com',
        }),
      }),
    );
  });

  test('maps email account connection tests to server routes', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { success: true } }))
      .mockResolvedValueOnce(jsonResponse({ data: { success: false, error: 'login failed' } }))
      .mockResolvedValueOnce(jsonResponse({ data: { success: true } }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          success: true,
          accountId: 7,
          emailAddress: 'agent@example.com',
        },
      }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.TestImap, {
      accountId: 7,
      imapHost: 'imap.example.com',
      imapPort: 993,
      imapTls: true,
      imapUsername: 'user@example.com',
      imapPassword: '',
    })).resolves.toEqual({ success: true });

    await expect(transport.invoke(IPCChannels.Email.TestPop3, {
      host: 'pop.example.com',
      port: 995,
      tls: true,
      user: 'user@example.com',
      password: 'secret',
    })).resolves.toEqual({ success: false, error: 'login failed' });

    await expect(transport.invoke(IPCChannels.Email.TestSmtp, {
      accountId: 7,
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      user: 'user@example.com',
      password: '',
      smtpUseImapAuth: true,
    })).resolves.toEqual({ success: true });
    await expect(transport.invoke(IPCChannels.Email.TestVacationAutoReply, 7)).resolves.toEqual({ success: true });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/email/accounts/test-imap',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          accountId: 7,
          imapHost: 'imap.example.com',
          imapPort: 993,
          imapTls: true,
          imapUsername: 'user@example.com',
          imapPassword: '',
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/email/accounts/test-pop3',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          host: 'pop.example.com',
          port: 995,
          tls: true,
          user: 'user@example.com',
          password: 'secret',
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      'https://crm.example.com/api/v1/email/accounts/test-smtp',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          accountId: 7,
          host: 'smtp.example.com',
          port: 587,
          secure: false,
          user: 'user@example.com',
          password: '',
          smtpUseImapAuth: true,
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      'https://crm.example.com/api/v1/email/accounts/7/vacation-test',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('maps server-created email account records to positive database IDs', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({
      data: {
        items: [
          {
            id: 9,
            sourceSqliteId: -3,
            displayName: 'Server account',
            emailAddress: 'server@example.com',
            protocol: 'imap',
            imapHost: 'imap.example.com',
            imapPort: 993,
            imapTls: true,
            imapUsername: 'server@example.com',
            smtpHost: null,
            smtpPort: null,
            smtpTls: true,
            smtpUsername: null,
            smtpUseImapAuth: true,
            pop3Host: null,
            pop3Port: null,
            pop3Tls: true,
            sentFolderPath: 'Sent',
            syncSpamFolderPath: null,
            syncArchiveFolderPath: null,
            imapSyncSent: false,
            imapSyncArchive: false,
            imapSyncSpam: false,
            imapSyncSeenOnOpen: true,
            vacationEnabled: false,
            vacationSubject: null,
            vacationBodyText: null,
            requestReadReceipt: false,
            updatedAt: '2026-06-03T10:00:00.000Z',
          },
        ],
      },
    }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.ListAccounts)).resolves.toEqual([
      expect.objectContaining({
        id: 9,
        source_sqlite_id: -3,
        display_name: 'Server account',
      }),
    ]);
  });

  test('maps message attachment metadata list including forwardable storage paths to server mail route', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({
      data: {
        items: [
          {
            id: 801,
            sourceSqliteId: 31,
            messageSourceSqliteId: 11,
            messageId: 701,
            filename: 'invoice.pdf',
            contentType: 'application/pdf',
            sizeBytes: 12345,
            contentSha256: 'sha256-31',
            storagePath: 'workspace-a/mail-sync/701/invoice.pdf',
            updatedAt: '2026-06-03T10:00:00.000Z',
          },
          {
            id: 802,
            sourceSqliteId: 32,
            messageSourceSqliteId: 11,
            messageId: 701,
            filename: 'packing-slip.pdf',
            contentType: 'application/pdf',
            sizeBytes: 23456,
            contentSha256: 'sha256-32',
            storagePath: 'workspace-a/mail-sync/701/packing-slip.pdf',
            updatedAt: '2026-06-03T10:00:00.000Z',
          },
          {
            id: 803,
            sourceSqliteId: 33,
            messageSourceSqliteId: 11,
            messageId: 701,
            filename: 'photo.jpg',
            contentType: 'image/jpeg',
            sizeBytes: 34567,
            contentSha256: 'sha256-33',
            storagePath: 'workspace-a/mail-sync/701/photo.jpg',
            updatedAt: '2026-06-03T10:00:00.000Z',
          },
        ],
      },
    }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.ListMessageAttachments, 11)).resolves.toEqual([
      {
        id: 801,
        source_sqlite_id: 31,
        filename_display: 'invoice.pdf',
        size_bytes: 12345,
        content_type: 'application/pdf',
        storage_path: 'workspace-a/mail-sync/701/invoice.pdf',
      },
      {
        id: 802,
        source_sqlite_id: 32,
        filename_display: 'packing-slip.pdf',
        size_bytes: 23456,
        content_type: 'application/pdf',
        storage_path: 'workspace-a/mail-sync/701/packing-slip.pdf',
      },
      {
        id: 803,
        source_sqlite_id: 33,
        filename_display: 'photo.jpg',
        size_bytes: 34567,
        content_type: 'image/jpeg',
        storage_path: 'workspace-a/mail-sync/701/photo.jpg',
      },
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/email/messages/11/attachments',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('maps single email message detail to legacy renderer shape', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({
      data: {
        id: 701,
        sourceSqliteId: 11,
        accountId: 101,
        folderId: 201,
        uid: 9001,
        messageId: '<message-11@example.com>',
        subject: 'Order update',
        from: [{ address: 'sender@example.com', name: 'Sender' }],
        to: [{ address: 'shop@example.com', name: 'Shop' }],
        cc: [],
        dateReceived: '2026-06-03T10:00:00.000Z',
        snippet: 'Short preview',
        seenLocal: false,
        doneLocal: true,
        archived: false,
        folderKind: 'inbox',
        threadId: 'thread-11',
        ticketCode: 'T-11',
        customerId: 42,
        hasAttachments: true,
        assignedTo: null,
        assignedToUserId: 'user-1',
        isSpam: false,
        spamStatus: 'clean',
        pgpStatus: null,
        remoteContentPolicy: 'ask',
        readReceiptRequested: true,
        bodyText: 'Plain body',
        bodyHtml: '<p>Plain body</p>',
        updatedAt: '2026-06-03T10:05:00.000Z',
      },
    }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.GetMessage, 701)).resolves.toEqual(
      expect.objectContaining({
        id: 701,
        source_sqlite_id: 11,
        account_id: 101,
        folder_id: 201,
        uid: 9001,
        subject: 'Order update',
        from_json: JSON.stringify({ value: [{ address: 'sender@example.com', name: 'Sender' }] }),
        to_json: JSON.stringify({ value: [{ address: 'shop@example.com', name: 'Shop' }] }),
        cc_json: JSON.stringify({ value: [] }),
        body_text: 'Plain body',
        body_html: '<p>Plain body</p>',
        seen_local: 0,
        done_local: 1,
        has_attachments: 1,
        assigned_to: 'user-1',
        read_receipt_requested: 1,
      }),
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/email/messages/701?includeBody=true',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('maps reply suggestion IPC channels to server HTTP routes', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          status: 'ready',
          text: 'Guten Tag',
          error: null,
          updatedAt: '2026-06-03T10:00:00.000Z',
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: { success: true, queued: true },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: { success: true, text: 'Direkter Entwurf' },
      }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.GetReplySuggestion, 701)).resolves.toEqual({
      status: 'ready',
      text: 'Guten Tag',
      error: null,
      updatedAt: '2026-06-03T10:00:00.000Z',
    });
    await expect(transport.invoke(IPCChannels.Email.EnsureReplySuggestion, {
      messageId: 701,
      force: true,
      trigger: 'open',
    })).resolves.toEqual({ success: true });
    await expect(transport.invoke(IPCChannels.Email.GenerateReplyDraft, {
      messageId: 701,
      promptId: 22,
      customerId: null,
    })).resolves.toEqual({ success: true, text: 'Direkter Entwurf' });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/email/messages/701/reply-suggestion',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/email/messages/701/reply-suggestion/ensure',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ force: true, trigger: 'open' }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      'https://crm.example.com/api/v1/email/messages/701/reply-draft',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ promptId: 22 }),
      }),
    );
  });

  test('maps email message security to legacy renderer shape', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({
      data: {
        authSpf: 'pass',
        authDkim: 'pass',
        authDmarc: 'fail',
        authArc: null,
        authDkimDomains: 'example.com',
        authError: null,
        rspamdScore: 1.25,
        rspamdAction: 'no action',
        rspamdSymbols: 'BAYES_HAM',
        rspamdError: null,
        securityCheckedAt: '2026-06-03T10:00:00.000Z',
        spamStatus: 'clean',
        spamScore: 12,
        spamScoreLabel: 'clean',
        spamDecisionSource: 'server',
        spamScoreBreakdownJson: { reasons: [{ label: 'trusted sender', points: -4 }] },
        spamDecidedAt: '2026-06-03T10:05:00.000Z',
      },
    }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.GetMessageSecurity, 701)).resolves.toEqual({
      success: true,
      authSpf: 'pass',
      authDkim: 'pass',
      authDmarc: 'fail',
      authArc: null,
      authDkimDomains: 'example.com',
      authError: null,
      rspamdScore: 1.25,
      rspamdAction: 'no action',
      rspamdSymbols: 'BAYES_HAM',
      rspamdError: null,
      securityCheckedAt: '2026-06-03T10:00:00.000Z',
      spamStatus: 'clean',
      spamScore: 12,
      spamScoreLabel: 'clean',
      spamDecisionSource: 'server',
      spamScoreBreakdownJson: JSON.stringify({ reasons: [{ label: 'trusted sender', points: -4 }] }),
      spamDecidedAt: '2026-06-03T10:05:00.000Z',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/email/messages/701/security',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('maps email raw headers to server mail route', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          rawEml: 'From: sender@example.com\r\n\r\nBody',
          emlSource: 'reconstructed',
          rawHeaders: 'From: sender@example.com',
          messageIdHeader: '<message-701@example.com>',
          fromJson: [{ address: 'sender@example.com' }],
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          rawEml: 'From: sender@example.com\r\n\r\nBody',
          emlSource: 'original',
          rawHeaders: 'From: sender@example.com',
        },
      }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.GetMessageRawHeaders, 701)).resolves.toEqual({
      success: true,
      rawEml: 'From: sender@example.com\r\n\r\nBody',
      emlSource: 'reconstructed',
      rawHeaders: 'From: sender@example.com',
      messageIdHeader: '<message-701@example.com>',
      fromJson: [{ address: 'sender@example.com' }],
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/email/messages/701/raw-headers',
      expect.objectContaining({ method: 'GET' }),
    );

    await expect(transport.invoke(IPCChannels.Email.ExportMessageEml, 701)).resolves.toEqual({
      success: true,
      rawEml: 'From: sender@example.com\r\n\r\nBody',
      emlSource: 'original',
    });
    expect(fetchImpl).toHaveBeenLastCalledWith(
      'https://crm.example.com/api/v1/email/messages/701/raw-headers',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('maps email read receipt state to server mail route', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({
      data: {
        success: true,
        requested: true,
        respond: 'ask',
        trustedDomains: 'example.com',
      },
    }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.GetReadReceiptState, { messageId: 701 })).resolves.toEqual({
      success: true,
      requested: true,
      respond: 'ask',
      trustedDomains: 'example.com',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/email/messages/701/read-receipt-state',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('maps email read receipt response to server mail route', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({
      data: {
        success: false,
        error: 'SMTP fehlt',
      },
    }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.RespondReadReceipt, {
      messageId: 701,
      action: 'send',
    })).resolves.toEqual({
      success: false,
      error: 'SMTP fehlt',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/email/messages/701/read-receipt-response',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ action: 'send' }),
      }),
    );
  });

  test('maps mail folder counts to server mail route', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          inbox: 3,
          inboxUnread: 2,
          sentFailed: 1,
          drafts: 4,
          archived: 5,
          spamReview: 6,
          spam: 7,
          trash: 8,
          snoozed: 9,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          inbox: 10,
          inboxUnread: 0,
          sentFailed: 0,
          drafts: 1,
          archived: 2,
          spamReview: 0,
          spam: 3,
          trash: 4,
          snoozed: 5,
        },
      }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.MailFolderCounts, 701)).resolves.toEqual({
      inbox: 3,
      inboxUnread: 2,
      sentFailed: 1,
      drafts: 4,
      archived: 5,
      spamReview: 6,
      spam: 7,
      trash: 8,
      snoozed: 9,
    });
    await expect(transport.invoke(IPCChannels.Email.MailFolderCounts, 'all')).resolves.toEqual({
      inbox: 10,
      inboxUnread: 0,
      sentFailed: 0,
      drafts: 1,
      archived: 2,
      spamReview: 0,
      spam: 3,
      trash: 4,
      snoozed: 5,
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/email/folder-counts?accountId=701',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/email/folder-counts',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('maps email diagnostics to server mail route', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({
      data: {
        collectedAt: '2026-06-04T10:00:00.000Z',
        schemaGeneration: 13,
        schemaGenerationLabel: '0013_email_compose_draft_fields Compose draft fields',
        sizes: { databaseBytes: null, attachmentsBytes: 2048 },
        messages: {
          total: 12,
          pendingPostProcess: 2,
          outboundHold: 1,
          byFolderKind: { inbox: 9, sent: 3 },
        },
        workflows: {
          runsLast24h: 5,
          runsBlockedLast24h: 1,
          runsErrorLast24h: 2,
        },
        notices: { imapAuth: 1, uidValidity: 0 },
        syncInfo: { totalKeys: 4, prefixes: { 'imap_auth_notice:': 1 } },
        background: {
          cronScheduled: false,
          cronTickInFlight: false,
          syncInFlightAccountIds: [],
          idleImapAccountIds: [],
        },
        accounts: [
          {
            id: 7,
            email: 'mail@example.com',
            protocol: 'imap',
            inboxLastSyncedAt: '2026-06-04T09:00:00.000Z',
          },
        ],
      },
    }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.GetMailDiagnostics)).resolves.toEqual(
      expect.objectContaining({
        schemaGeneration: 13,
        sizes: { databaseBytes: null, attachmentsBytes: 2048 },
        messages: expect.objectContaining({ total: 12, byFolderKind: { inbox: 9, sent: 3 } }),
        accounts: [
          {
            id: 7,
            email: 'mail@example.com',
            protocol: 'imap',
            inboxLastSyncedAt: '2026-06-04T09:00:00.000Z',
          },
        ],
      }),
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/email/diagnostics',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('maps email reporting to server mail route', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({
      data: {
        accounts: [{
          id: 7,
          displayName: 'Support',
          emailAddress: 'support@example.com',
          protocol: 'imap',
        }],
        totals: {
          messages: 12,
          unread: 3,
          archived: 2,
          withCustomer: 5,
          withAssignment: 4,
          withAttachments: 6,
        },
        perAccount: [{ accountId: 7, messages: 12, unread: 3, archived: 2 }],
        workflowRuns24h: [{ workflowId: 9, count: 5, errors: 1 }],
      },
    }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.EmailReporting, 7)).resolves.toEqual({
      success: true,
      data: {
        accounts: [{
          id: 7,
          display_name: 'Support',
          email_address: 'support@example.com',
          protocol: 'imap',
        }],
        totals: {
          messages: 12,
          unread: 3,
          archived: 2,
          withCustomer: 5,
          withAssignment: 4,
          withAttachments: 6,
        },
        perAccount: [{ accountId: 7, messages: 12, unread: 3, archived: 2 }],
        workflowRuns24h: [{ workflow_id: 9, count: 5, errors: 1 }],
      },
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/email/reporting?accountId=7',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('maps email GDPR export to server ZIP download route', async () => {
    const blob = new Blob(['zip-bytes'], { type: 'application/zip' });
    const fetchImpl = jest.fn().mockResolvedValueOnce(blobResponse(blob, {
      'Content-Disposition': 'attachment; filename="gdpr export.zip"',
      'Content-Type': 'application/zip',
    }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
      getAccessToken: () => 'access-1',
    });

    await expect(transport.invoke(IPCChannels.Email.EmailGdprExport, {
      skipAttachments: true,
    })).resolves.toEqual({
      ok: true,
      blob,
      filename: 'gdpr export.zip',
      contentType: 'application/zip',
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/email/gdpr-export?skipAttachments=true',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Accept: 'application/octet-stream, application/json',
          Authorization: 'Bearer access-1',
        }),
      }),
    );
  });

  test('maps email GDPR export API errors to RendererTransportError', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({
      error: {
        code: 'attachments_too_large',
        message: 'Anhaenge zu gross fuer einen Export',
        details: { attachmentBytes: 5, maxBytes: 4 },
      },
    }, 409));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.EmailGdprExport)).rejects.toMatchObject({
      name: 'RendererTransportError',
      status: 409,
      code: 'attachments_too_large',
      message: 'Anhaenge zu gross fuer einen Export',
      details: { attachmentBytes: 5, maxBytes: 4 },
    });
  });

  test('maps email customer-link backfill to server mail route', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({
      data: { success: true, count: 4 },
    }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.BackfillCustomerLinks, {
      accountId: 701,
      limit: 500,
    })).resolves.toEqual({ success: true, count: 4 });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/email/messages/backfill-customer-links',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ accountId: 701, limit: 500 }),
      }),
    );
  });

  test('maps email remote content policy channels to server routes', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { policy: 'allowed_once', allowRemote: true } }))
      .mockResolvedValueOnce(jsonResponse({ data: { success: true, policy: 'allowed_sender', allowRemote: true } }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.GetRemoteContentPolicy, { messageId: 701 })).resolves.toEqual({
      policy: 'allowed_once',
      allowRemote: true,
    });
    await expect(transport.invoke(IPCChannels.Email.SetRemoteContentPolicy, {
      messageId: 701,
      policy: 'allowed_sender',
      rememberSender: true,
    })).resolves.toEqual({ success: true });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/email/messages/701/remote-content-policy/consume',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/email/messages/701/remote-content-policy',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ policy: 'allowed_sender', rememberSender: true }),
      }),
    );
  });

  test('maps compose draft and scheduled-send channels to server routes', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [{
            sourceSqliteId: -71,
            accountSourceSqliteId: 7,
            accountId: 7,
            signatureHtml: '<p>Signature</p>',
            updatedAt: '2026-06-03T10:00:00.000Z',
          }],
          nextCursor: null,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({ data: { success: true, id: 44 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { success: true } }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          success: true,
          warning: 'E-Mail wurde per SMTP versendet und in SimpleCRM als gesendet markiert. Server-Kopie per IMAP APPEND ist fuer diesen Sender nicht konfiguriert.',
        },
      }))
      .mockResolvedValueOnce(jsonResponse({ data: { success: true } }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          success: true,
          failureCount: 2,
          status: 'failed',
          lastError: 'SMTP rejected message',
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          success: true,
          smtpCommitted: true,
          needsResendFinalize: true,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({ data: { success: true } }))
      .mockResolvedValueOnce(jsonResponse({ data: { success: true } }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.GetComposeSignature, { accountId: 7 })).resolves.toEqual({
      html: '<p>Signature</p>',
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/email/account-signatures?accountId=7&limit=1',
      expect.objectContaining({ method: 'GET' }),
    );

    await expect(transport.invoke(IPCChannels.Email.CreateComposeDraft, {
      accountId: 7,
      subject: 'Draft',
      bodyText: 'Hello',
      to: 'Person <person+tag@example.com>',
    })).resolves.toEqual({ success: true, id: 44 });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/email/compose-drafts',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          accountId: 7,
          subject: 'Draft',
          bodyText: 'Hello',
          to: 'Person <person+tag@example.com>',
        }),
      }),
    );

    await expect(transport.invoke(IPCChannels.Email.UpdateComposeDraft, {
      messageId: 44,
      subject: 'Draft 2',
      bodyText: 'Plain',
      bodyHtml: '<p>Plain</p>',
      to: 'person@example.com',
      cc: 'cc@example.com',
      bcc: 'bcc@example.com',
      draftAttachmentPaths: [' /tmp/a.txt ', '', '/tmp/a.txt'],
      replyParentMessageId: 11,
      markReplyParentDone: true,
    })).resolves.toEqual({ success: true });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      'https://crm.example.com/api/v1/email/messages/44/compose-draft',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          subject: 'Draft 2',
          bodyText: 'Plain',
          bodyHtml: '<p>Plain</p>',
          to: 'person@example.com',
          cc: 'cc@example.com',
          bcc: 'bcc@example.com',
          draftAttachmentPaths: ['/tmp/a.txt'],
          replyParentMessageId: 11,
          markReplyParentDone: true,
        }),
      }),
    );

    await expect(transport.invoke(IPCChannels.Email.SendCompose, {
      accountId: 7,
      draftMessageId: 44,
      subject: 'Draft 2',
      bodyText: 'Plain',
      bodyHtml: null,
      to: 'person@example.com',
      cc: 'cc@example.com',
      bcc: 'bcc@example.com',
      inReplyToMessageId: 11,
      attachmentPaths: [],
      markReplyParentDone: true,
      requestReadReceipt: true,
      pgpEncrypt: true,
      pgpSign: true,
      pgpPassphrase: ' passphrase with spaces ',
    })).resolves.toEqual({
      success: true,
      warning: 'E-Mail wurde per SMTP versendet und in SimpleCRM als gesendet markiert. Server-Kopie per IMAP APPEND ist fuer diesen Sender nicht konfiguriert.',
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      'https://crm.example.com/api/v1/email/compose/send',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          accountId: 7,
          draftMessageId: 44,
          subject: 'Draft 2',
          bodyText: 'Plain',
          bodyHtml: null,
          to: 'person@example.com',
          cc: 'cc@example.com',
          bcc: 'bcc@example.com',
          inReplyToMessageId: 11,
          attachmentPaths: [],
          markReplyParentDone: true,
          requestReadReceipt: true,
          pgpEncrypt: true,
          pgpSign: true,
          pgpPassphrase: ' passphrase with spaces ',
        }),
      }),
    );

    await expect(transport.invoke(IPCChannels.Email.ScheduleDraftSend, {
      messageId: 44,
      sendAt: '2026-06-04T15:00:00.000Z',
    })).resolves.toEqual({ success: true });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      5,
      'https://crm.example.com/api/v1/email/messages/44/scheduled-send',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ sendAt: '2026-06-04T15:00:00.000Z' }),
      }),
    );

    await expect(transport.invoke(IPCChannels.Email.GetScheduledSendDraftState, 44)).resolves.toEqual({
      success: true,
      failureCount: 2,
      status: 'failed',
      lastError: 'SMTP rejected message',
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      6,
      'https://crm.example.com/api/v1/email/messages/44/scheduled-send-state',
      expect.objectContaining({ method: 'GET' }),
    );

    await expect(transport.invoke(IPCChannels.Email.GetComposeDraftRecoveryState, 44)).resolves.toEqual({
      success: true,
      smtpCommitted: true,
      needsResendFinalize: true,
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      7,
      'https://crm.example.com/api/v1/email/messages/44/compose-draft-recovery-state',
      expect.objectContaining({ method: 'GET' }),
    );

    await expect(transport.invoke(IPCChannels.Email.ClearScheduledSendDraftFailure, 44)).resolves.toEqual({ success: true });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      8,
      'https://crm.example.com/api/v1/email/messages/44/scheduled-send-failure',
      expect.objectContaining({ method: 'DELETE' }),
    );

    await expect(transport.invoke(IPCChannels.Email.RetryScheduledSendDraft, 44)).resolves.toEqual({ success: true });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      9,
      'https://crm.example.com/api/v1/email/messages/44/scheduled-send/retry',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  test('uploads server-client compose attachments through the HTTP transport', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
      data: {
        success: true,
        path: 'workspace-a/compose-drafts/44/abc-invoice.pdf',
        filename: 'invoice.pdf',
        sizeBytes: 12,
      },
      }),
    });
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: fetchImpl,
    });
    configureRendererTransportFromDeployConfig({
      mode: 'server-client',
      server: { baseUrl: 'https://crm.example.com/' },
    });

    await expect(uploadServerComposeAttachment({
      draftMessageId: 44,
      filename: 'invoice.pdf',
      contentBase64: 'aW52b2ljZSBkYXRh',
      contentType: 'application/pdf',
    })).resolves.toEqual({
      path: 'workspace-a/compose-drafts/44/abc-invoice.pdf',
      filename: 'invoice.pdf',
      sizeBytes: 12,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/email/messages/44/compose-attachments',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          filename: 'invoice.pdf',
          contentBase64: 'aW52b2ljZSBkYXRh',
          contentType: 'application/pdf',
        }),
      }),
    );
  });

  test('uses direct HTTP helpers for server-client PGP attachment actions', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          data: {
            filename: 'invoice.pdf',
            contentType: 'application/pdf',
            contentBase64: 'ZGVjcnlwdGVk',
            sizeBytes: 9,
            status: 'decrypted',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          data: {
            valid: true,
            status: 'signed_valid',
            fingerprint: 'abcdef1234567890',
          },
        }),
      });
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: fetchImpl,
    });
    configureRendererTransportFromDeployConfig({
      mode: 'server-client',
      server: { baseUrl: 'https://crm.example.com/' },
    });

    await expect(decryptServerPgpAttachment({
      attachmentId: 31,
      passphrase: ' passphrase ',
    })).resolves.toEqual({
      filename: 'invoice.pdf',
      contentType: 'application/pdf',
      contentBase64: 'ZGVjcnlwdGVk',
      sizeBytes: 9,
      status: 'decrypted',
    });
    await expect(verifyServerPgpAttachment({
      attachmentId: 32,
      signatureAttachmentId: 33,
    })).resolves.toEqual({
      valid: true,
      status: 'signed_valid',
      fingerprint: 'abcdef1234567890',
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/pgp/attachments/31/decrypt',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ passphrase: ' passphrase ' }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/pgp/attachments/32/verify',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ signatureAttachmentId: 33 }),
      }),
    );
  });

  test('maps outbound validation channel to server route', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          success: true,
          allowed: false,
          reason: 'Ausgangspruefung wird serverseitig ausgefuehrt',
        },
      }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.ValidateOutbound, {
      messageId: 44,
      subject: 'Pruefung',
      bodyText: 'Bitte pruefen',
      bodyHtml: '<p>Bitte pruefen</p>',
      to: 'kunde@example.com',
      cc: 'team@example.com',
      bcc: 'audit@example.com',
      inReplyToMessageId: 11,
      attachmentCount: 2,
    })).resolves.toEqual({
      success: true,
      allowed: false,
      reason: 'Ausgangspruefung wird serverseitig ausgefuehrt',
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/email/compose/validate-outbound',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          messageId: 44,
          subject: 'Pruefung',
          bodyText: 'Bitte pruefen',
          bodyHtml: '<p>Bitte pruefen</p>',
          to: 'kunde@example.com',
          cc: 'team@example.com',
          bcc: 'audit@example.com',
          inReplyToMessageId: 11,
          attachmentCount: 2,
        }),
      }),
    );
  });

  test('maps email OAuth app and account-link channels to server routes', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { success: true, clientId: 'google-client', clientSecret: 'google-secret' } }))
      .mockResolvedValueOnce(jsonResponse({ data: { success: true } }))
      .mockResolvedValueOnce(jsonResponse({ data: { success: true, url: 'https://oauth.example.com/google' } }))
      .mockResolvedValueOnce(jsonResponse({ data: { success: true } }))
      .mockResolvedValueOnce(jsonResponse({ data: { success: true, clientId: 'ms-client', clientSecret: 'ms-secret' } }))
      .mockResolvedValueOnce(jsonResponse({ data: { success: true } }))
      .mockResolvedValueOnce(jsonResponse({ data: { success: true, url: 'https://oauth.example.com/microsoft' } }))
      .mockResolvedValueOnce(jsonResponse({ data: { success: true } }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.GetGoogleOAuthApp)).resolves.toEqual({
      success: true,
      clientId: 'google-client',
      clientSecret: 'google-secret',
    });
    await expect(transport.invoke(IPCChannels.Email.SetGoogleOAuthApp, {
      clientId: ' google-client ',
      clientSecret: ' google-secret ',
    })).resolves.toEqual({ success: true });
    await expect(transport.invoke(IPCChannels.Email.BuildGoogleOAuthUrl, 'http://127.0.0.1:1')).resolves.toEqual({
      success: true,
      url: 'https://oauth.example.com/google',
    });
    await expect(transport.invoke(IPCChannels.Email.FinishGoogleOAuth, {
      accountId: 7,
      redirectUri: 'http://127.0.0.1:1',
      code: 'google-code',
    })).resolves.toEqual({ success: true });
    await expect(transport.invoke(IPCChannels.Email.GetMicrosoftOAuthApp)).resolves.toEqual({
      success: true,
      clientId: 'ms-client',
      clientSecret: 'ms-secret',
    });
    await expect(transport.invoke(IPCChannels.Email.SetMicrosoftOAuthApp, {
      clientId: 'ms-client',
      clientSecret: 'ms-secret',
    })).resolves.toEqual({ success: true });
    await expect(transport.invoke(IPCChannels.Email.BuildMicrosoftOAuthUrl, 'http://127.0.0.1:1')).resolves.toEqual({
      success: true,
      url: 'https://oauth.example.com/microsoft',
    });
    await expect(transport.invoke(IPCChannels.Email.FinishMicrosoftOAuth, {
      accountId: 8,
      redirectUri: 'http://127.0.0.1:1',
      code: 'ms-code',
    })).resolves.toEqual({ success: true });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/email/oauth/google/app',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/email/oauth/google/app',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ clientId: 'google-client', clientSecret: 'google-secret' }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      'https://crm.example.com/api/v1/email/oauth/google/authorize-url',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ redirectUri: 'http://127.0.0.1:1' }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      'https://crm.example.com/api/v1/email/oauth/google/finish',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ accountId: 7, redirectUri: 'http://127.0.0.1:1', code: 'google-code' }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      5,
      'https://crm.example.com/api/v1/email/oauth/microsoft/app',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      6,
      'https://crm.example.com/api/v1/email/oauth/microsoft/app',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ clientId: 'ms-client', clientSecret: 'ms-secret' }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      7,
      'https://crm.example.com/api/v1/email/oauth/microsoft/authorize-url',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ redirectUri: 'http://127.0.0.1:1' }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      8,
      'https://crm.example.com/api/v1/email/oauth/microsoft/finish',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ accountId: 8, redirectUri: 'http://127.0.0.1:1', code: 'ms-code' }),
      }),
    );
  });

  test('maps conversation and thread message reads to server list routes', async () => {
    const message = {
      id: 701,
      sourceSqliteId: 11,
      accountId: 101,
      folderId: 201,
      uid: 9001,
      subject: 'Thread hit',
      from: { value: [{ address: 'sender@example.com' }] },
      to: null,
      cc: null,
      dateReceived: '2026-06-03T10:00:00.000Z',
      snippet: 'Short preview',
      seenLocal: true,
      doneLocal: false,
      archived: false,
      folderKind: 'inbox',
      threadId: 'thread/encoded',
      imapThreadId: 'imap-1',
      ticketCode: 'T-11',
      customerId: 42,
      hasAttachments: false,
      assignedTo: null,
      assignedToUserId: null,
      isSpam: false,
      spamStatus: 'clean',
      pgpStatus: null,
      remoteContentPolicy: 'ask',
      readReceiptRequested: false,
      snoozedUntil: null,
      updatedAt: '2026-06-03T10:05:00.000Z',
    };
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { items: [message], nextCursor: null } }))
      .mockResolvedValueOnce(jsonResponse({ data: { items: [message], nextCursor: null } }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [
            {
              id: 'thread/encoded',
              ticketCode: 'T-11',
              rootMessageSourceSqliteId: 11,
              rootMessageId: 701,
              lastMessageAt: '2026-06-03T10:00:00.000Z',
              messageCount: 2,
              hasUnread: true,
              hasAttachments: false,
              subjectNormalized: 'Thread hit',
              createdAt: '2026-06-03T09:00:00.000Z',
              updatedAt: '2026-06-03T10:00:00.000Z',
            },
          ],
          nextCursor: null,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [
            {
              messageId: 701,
              accountId: 101,
              subject: 'Thread hit',
              aliasThreadId: 'thread/encoded',
              canonicalThreadId: 'thread-canonical',
              confidence: 'medium',
            },
          ],
          nextCursor: null,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          success: true,
          movedMessageCount: 2,
          orphanThreadDeleted: true,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          success: true,
          threadId: 'th-split',
          ticketCode: 'SCR-ABC123',
        },
      }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.ListConversationMessages, {
      accountId: 101,
      messageId: 11,
      ticketCode: ' T-11 ',
      customerId: 42,
      correspondentEmail: ' sender@example.com ',
      limit: 50,
    })).resolves.toEqual([
      expect.objectContaining({
        id: 701,
        thread_id: 'thread/encoded',
        imap_thread_id: 'imap-1',
        ticket_code: 'T-11',
      }),
    ]);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/email/messages/conversation?accountId=101&messageId=11&ticketCode=T-11&customerId=42&correspondentEmail=sender%40example.com&limit=50',
      expect.objectContaining({ method: 'GET' }),
    );

    await expect(transport.invoke(IPCChannels.Email.ListThreadMessages, {
      threadId: 'thread/encoded',
      limit: 50,
      offset: 10,
    })).resolves.toEqual([
      expect.objectContaining({
        id: 701,
        thread_id: 'thread/encoded',
        imap_thread_id: 'imap-1',
      }),
    ]);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/email/threads/thread%2Fencoded/messages?limit=50&offset=10',
      expect.objectContaining({ method: 'GET' }),
    );

    await expect(transport.invoke(IPCChannels.Email.ListThreadsByView, {
      accountScope: 101,
      view: 'inbox',
      limit: 50,
      offset: 10,
    })).resolves.toEqual([
      expect.objectContaining({
        threadId: 'thread/encoded',
        thread_id: 'thread/encoded',
        ticket_code: 'T-11',
        messageCount: 2,
        hasUnread: true,
        latestMessageId: 701,
      }),
    ]);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      'https://crm.example.com/api/v1/email/threads?accountId=101&view=inbox&limit=50&offset=10',
      expect.objectContaining({ method: 'GET' }),
    );

    await expect(transport.invoke(IPCChannels.Email.ListThreadAliasWarnings)).resolves.toEqual([
      {
        messageId: 701,
        accountId: 101,
        subject: 'Thread hit',
        aliasThreadId: 'thread/encoded',
        canonicalThreadId: 'thread-canonical',
        confidence: 'medium',
      },
    ]);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      'https://crm.example.com/api/v1/email/thread-alias-warnings?limit=50',
      expect.objectContaining({ method: 'GET' }),
    );

    await expect(transport.invoke(IPCChannels.Email.MergeThreads, {
      aliasThreadId: ' thread/encoded ',
      canonicalThreadId: ' thread-canonical ',
      accountId: '101',
    })).resolves.toEqual({ success: true });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      5,
      'https://crm.example.com/api/v1/email/threads/merge',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          aliasThreadId: 'thread/encoded',
          canonicalThreadId: 'thread-canonical',
          accountId: 101,
        }),
      }),
    );

    await expect(transport.invoke(IPCChannels.Email.SplitMessageThread, {
      messageId: '701',
    })).resolves.toEqual({ success: true, threadId: 'th-split' });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      6,
      'https://crm.example.com/api/v1/email/threads/split-message',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ messageId: 701 }),
      }),
    );
  });

  test('maps safe bulk message mutations to server routes', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { count: 2 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { count: 1 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { count: 2 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { count: 1 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { count: 3 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { count: 2 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { count: 1 } }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.BulkSetMessagesArchived, {
      messageIds: [11, 12],
      archived: true,
      accountId: 101,
    })).resolves.toEqual({ success: true, count: 2 });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/email/messages/bulk/archive',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ messageIds: [11, 12], archived: true, accountId: 101 }),
      }),
    );

    await expect(transport.invoke(IPCChannels.Email.BulkSetMessageDone, {
      messageIds: [11],
      done: false,
    })).resolves.toEqual({ success: true, count: 1 });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/email/messages/bulk/done',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ messageIds: [11], done: false }),
      }),
    );

    await expect(transport.invoke(IPCChannels.Email.BulkSetMessageSpam, {
      messageIds: [11, 12],
      spam: true,
      accountId: 101,
    })).resolves.toEqual({ success: true, count: 2 });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      'https://crm.example.com/api/v1/email/messages/bulk/spam-status',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ messageIds: [11, 12], status: 'spam', accountId: 101 }),
      }),
    );

    await expect(transport.invoke(IPCChannels.Email.BulkSetMessageSpamStatus, {
      messageIds: [13],
      status: 'review',
      train: false,
    })).resolves.toEqual({ success: true, count: 1 });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      'https://crm.example.com/api/v1/email/messages/bulk/spam-status',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ messageIds: [13], status: 'review', train: false }),
      }),
    );

    await expect(transport.invoke(IPCChannels.Email.BulkSoftDeleteMessages, {
      messageIds: [11, 12, 13],
      accountId: null,
    })).resolves.toEqual({ success: true, count: 3 });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      5,
      'https://crm.example.com/api/v1/email/messages/bulk/soft-delete',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ messageIds: [11, 12, 13] }),
      }),
    );

    await expect(transport.invoke(IPCChannels.Email.BulkDeleteComposeDrafts, {
      messageIds: [21, 22],
    })).resolves.toEqual({ success: true, count: 2 });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      6,
      'https://crm.example.com/api/v1/email/messages/bulk/local-drafts',
      expect.objectContaining({
        method: 'DELETE',
        body: JSON.stringify({ messageIds: [21, 22] }),
      }),
    );

    await expect(transport.invoke(IPCChannels.Email.SnoozeMessage, {
      messageId: 11,
      until: null,
    })).resolves.toEqual({ success: true });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      7,
      'https://crm.example.com/api/v1/email/messages/11/snooze',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ until: null }),
      }),
    );
  });

  test('maps safe single message status mutations to server routes', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { count: 1 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { count: 1 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { count: 1 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { count: 1 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { count: 1 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { count: 1 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { count: 1 } }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.SoftDeleteMessage, 11)).resolves.toEqual({ success: true });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/email/messages/11/soft-delete',
      expect.objectContaining({ method: 'PATCH' }),
    );

    await expect(transport.invoke(IPCChannels.Email.RestoreMessage, 11)).resolves.toEqual({ success: true });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/email/messages/11/restore',
      expect.objectContaining({ method: 'PATCH' }),
    );

    await expect(transport.invoke(IPCChannels.Email.DeleteComposeDraft, 11)).resolves.toEqual({ success: true });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      'https://crm.example.com/api/v1/email/messages/11/local-draft',
      expect.objectContaining({ method: 'DELETE' }),
    );

    await expect(transport.invoke(IPCChannels.Email.SetMessageArchived, {
      messageId: 11,
      archived: true,
    })).resolves.toEqual({ success: true });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      'https://crm.example.com/api/v1/email/messages/11/archive',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ archived: true }),
      }),
    );

    await expect(transport.invoke(IPCChannels.Email.SetMessageSeen, {
      messageId: 11,
      seen: false,
      syncToServer: false,
    })).resolves.toEqual({ success: true });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      5,
      'https://crm.example.com/api/v1/email/messages/11/seen',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ seen: false, syncToServer: false }),
      }),
    );

    await expect(transport.invoke(IPCChannels.Email.SetMessageDone, {
      messageId: 11,
      done: true,
    })).resolves.toEqual({ success: true });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      6,
      'https://crm.example.com/api/v1/email/messages/11/done',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ done: true }),
      }),
    );

    await expect(transport.invoke(IPCChannels.Email.MoveMessageToView, {
      messageId: 11,
      view: 'archived',
    })).resolves.toEqual({ success: true });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      7,
      'https://crm.example.com/api/v1/email/messages/11/move',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ view: 'archived' }),
      }),
    );
  });

  test('maps email message view lists to server query parameters', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({
      data: {
        items: [
          {
            id: 701,
            sourceSqliteId: 11,
            accountId: 101,
            folderId: 201,
            uid: 9001,
            subject: 'Inbox message',
            from: { value: [{ address: 'sender@example.com' }] },
            to: null,
            cc: null,
            dateReceived: '2026-06-03T10:00:00.000Z',
            snippet: 'Short preview',
            seenLocal: true,
            doneLocal: false,
            archived: false,
            folderKind: 'inbox',
            threadId: null,
            ticketCode: null,
            customerId: null,
            hasAttachments: false,
            assignedTo: null,
            assignedToUserId: null,
            isSpam: false,
            spamStatus: 'clean',
            pgpStatus: null,
            remoteContentPolicy: 'ask',
            readReceiptRequested: false,
            snoozedUntil: null,
            updatedAt: '2026-06-03T10:05:00.000Z',
          },
        ],
        nextCursor: null,
      },
    }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.ListMessagesByView, {
      accountId: 'all',
      view: 'inbox',
      limit: 100,
      offset: 20,
      categoryId: 5,
      sort: 'priority',
      listFilter: 'unread',
      doneFilter: 'open',
    })).resolves.toEqual([
      expect.objectContaining({
        id: 701,
        source_sqlite_id: 11,
        from_json: JSON.stringify({ value: [{ address: 'sender@example.com' }] }),
        seen_local: 1,
        snoozed_until: null,
      }),
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/email/messages?view=inbox&limit=100&offset=20&categoryId=5&sort=priority&listFilter=unread&doneFilter=open',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('maps legacy email folder message lists to server folderPath queries', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [{
            id: 701,
            sourceSqliteId: 11,
            accountId: 101,
            folderId: 201,
            uid: 9001,
            subject: 'Default inbox message',
            from: null,
            to: null,
            cc: null,
            dateReceived: '2026-06-03T10:00:00.000Z',
            snippet: 'Short preview',
            seenLocal: false,
            doneLocal: false,
            archived: false,
            folderKind: 'inbox',
            threadId: null,
            ticketCode: null,
            customerId: null,
            hasAttachments: false,
            assignedTo: null,
            assignedToUserId: null,
            isSpam: false,
            spamStatus: 'clean',
            pgpStatus: null,
            remoteContentPolicy: 'ask',
            readReceiptRequested: false,
            snoozedUntil: null,
            updatedAt: '2026-06-03T10:05:00.000Z',
          }],
          nextCursor: null,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [{
            id: 702,
            sourceSqliteId: 12,
            accountId: 101,
            folderId: 202,
            uid: 9002,
            subject: 'Archive message',
            from: null,
            to: null,
            cc: null,
            dateReceived: '2026-06-03T11:00:00.000Z',
            snippet: null,
            seenLocal: true,
            doneLocal: false,
            archived: true,
            folderKind: 'archived',
            threadId: null,
            ticketCode: null,
            customerId: null,
            hasAttachments: false,
            assignedTo: null,
            assignedToUserId: null,
            isSpam: false,
            spamStatus: 'clean',
            pgpStatus: null,
            remoteContentPolicy: 'ask',
            readReceiptRequested: false,
            snoozedUntil: null,
            updatedAt: '2026-06-03T11:05:00.000Z',
          }],
          nextCursor: null,
        },
      }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.ListMessages, {
      accountId: 101,
      limit: 25,
      offset: 5,
    })).resolves.toEqual([
      expect.objectContaining({
        id: 701,
        source_sqlite_id: 11,
        subject: 'Default inbox message',
      }),
    ]);
    await expect(transport.invoke(IPCChannels.Email.ListMessages, {
      accountId: 101,
      folderPath: 'Archive/2026',
      limit: 10,
    })).resolves.toEqual([
      expect.objectContaining({
        id: 702,
        source_sqlite_id: 12,
        subject: 'Archive message',
      }),
    ]);

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/email/messages?accountId=101&folderPath=INBOX&limit=25&offset=5',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/email/messages?accountId=101&folderPath=Archive%2F2026&limit=10&offset=0',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('maps email message id lists to filtered server message route', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({
      data: {
        items: [
          { id: 701 },
          { id: 702 },
        ],
        nextCursor: null,
      },
    }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.ListMessageIdsByView, {
      accountId: 101,
      view: 'archived',
      limit: 500,
      offset: 0,
      categoryId: null,
      listFilter: 'attachment',
      doneFilter: undefined,
    })).resolves.toEqual([701, 702]);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/email/messages?accountId=101&view=archived&limit=500&offset=0&listFilter=attachment',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('maps email message search to server list route with metadata result', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({
      data: {
        items: [
          {
            id: 702,
            accountId: 101,
            folderId: 201,
            uid: 9002,
            subject: 'Search hit',
            from: null,
            to: null,
            cc: null,
            dateReceived: null,
            snippet: null,
            seenLocal: false,
            doneLocal: false,
            archived: false,
            folderKind: 'inbox',
            threadId: null,
            ticketCode: null,
            customerId: null,
            hasAttachments: false,
            assignedTo: null,
            assignedToUserId: null,
            isSpam: false,
            spamStatus: 'clean',
            pgpStatus: null,
            remoteContentPolicy: 'ask',
            readReceiptRequested: false,
            snoozedUntil: null,
            updatedAt: '2026-06-03T10:05:00.000Z',
          },
        ],
        nextCursor: 702,
        searchMode: 'fts',
      },
    }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.SearchMessages, {
      accountId: 101,
      query: 'Search',
      limit: 50,
      offset: 10,
      view: 'inbox',
      categoryId: null,
      doneFilter: 'all',
    })).resolves.toEqual({
      messages: [expect.objectContaining({ id: 702, subject: 'Search hit' })],
      searchMode: 'fts',
      hasMore: true,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/email/messages?accountId=101&search=Search&limit=50&offset=10&view=inbox&doneFilter=all',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('maps message spam status mutation to server mail route', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 11,
          spamStatus: 'clean',
          isSpam: false,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 11,
          spamStatus: 'spam',
          isSpam: true,
        },
      }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.SetMessageSpam, {
      messageId: 11,
      spam: false,
    })).resolves.toEqual({ success: true });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/email/messages/11/spam-status',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'clean' }),
      }),
    );

    await expect(transport.invoke(IPCChannels.Email.SetMessageSpamStatus, {
      messageId: 11,
      status: 'spam',
      train: true,
    })).resolves.toEqual({ success: true });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/email/messages/11/spam-status',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          status: 'spam',
          train: true,
          source: 'manual',
        }),
      }),
    );
  });

  test('maps manual mail security check to the server security check route', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({
      data: {
        authChecked: true,
        rspamdChecked: true,
        security: {
          spamScore: 61,
          spamStatus: 'review',
          spamDecisionSource: 'server-spam-engine',
        },
        decision: {
          score: 61,
          status: 'review',
          source: 'server-spam-engine',
        },
      },
    }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.RunMailSecurityCheck, 11)).resolves.toEqual({
      success: true,
      authChecked: true,
      rspamdChecked: true,
      spamScore: 61,
      spamStatus: 'review',
      spamDecisionSource: 'server-spam-engine',
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/email/messages/11/security/check',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ applyStatus: true }),
      }),
    );
  });

  test('maps workspace settings channels to sync-info backed server routes', async () => {
    const securitySettings = {
      mailauthEnabled: true,
      rspamdEnabled: false,
      rspamdUrl: 'http://127.0.0.1:11333',
      rspamdTimeoutMs: 8000,
      rspamdSpamScore: 15,
      autoSpamDmarcFail: false,
      autoSpamSpfFail: false,
      autoSpamRspamd: false,
      senderWhitelist: '',
      senderBlacklist: '',
      spamScoreThreshold: 70,
      spamEngineEnabled: true,
      spamReviewThreshold: 45,
      spamSpamThreshold: 75,
      localLearningEnabled: true,
      rspamdContributionEnabled: false,
      rspamdLearningEnabled: false,
      aiSpamWorkflowEnabled: false,
    };
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          imapDeleteOptIn: true,
          httpAllowlist: 'hooks.example.com',
          senderWhitelist: '',
          senderBlacklist: '',
          spamScoreThreshold: '82',
        },
      }))
      .mockResolvedValueOnce(jsonResponse({ data: { success: true } }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          webhookSecret: 'secret-1',
          maxAttachmentMb: '30',
        },
      }))
      .mockResolvedValueOnce(jsonResponse({ data: { success: true } }))
      .mockResolvedValueOnce(jsonResponse({ data: securitySettings }))
      .mockResolvedValueOnce(jsonResponse({ data: { success: true } }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          eveningHour: 18,
          eveningMinute: 0,
          morningHour: 9,
          morningMinute: 0,
          nextWeekWeekday: 1,
          nextWeekHour: 9,
          nextWeekMinute: 0,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({ data: { success: true } }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          autoEnabled: true,
          triggerOnInbound: true,
          triggerOnOpen: false,
          categoryMode: 'only_listed',
          categoryIds: [4, 5],
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          autoEnabled: false,
          triggerOnInbound: true,
          triggerOnOpen: true,
          categoryMode: 'only_listed',
          categoryIds: [5],
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [
            {
              id: '1:100',
              accountId: 1,
              folderPath: 'INBOX',
              oldValidity: '1',
              newValidity: '2',
              messageCount: 5,
              backedUpCount: 3,
              at: '2026-06-03T10:00:00.000Z',
            },
          ],
        },
      }))
      .mockResolvedValueOnce(jsonResponse({ data: { success: true } }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [
            {
              accountId: 5,
              message: 'OAuth refresh failed',
              at: '2026-06-03T11:00:00.000Z',
            },
          ],
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          success: true,
        },
      }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.GetWorkflowAutomationSettings)).resolves.toEqual({
      imapDeleteOptIn: true,
      httpAllowlist: 'hooks.example.com',
      senderWhitelist: '',
      senderBlacklist: '',
      spamScoreThreshold: '82',
    });
    await expect(transport.invoke(IPCChannels.Email.SetWorkflowAutomationSettings, {
      imapDeleteOptIn: false,
      httpAllowlist: ' hooks.example.com ',
      spamScoreThreshold: '101',
    })).resolves.toEqual({ success: true });
    await expect(transport.invoke(IPCChannels.Email.GetEmailMiscSettings)).resolves.toEqual({
      webhookSecret: 'secret-1',
      maxAttachmentMb: '30',
    });
    await expect(transport.invoke(IPCChannels.Email.SetEmailMiscSettings, {
      webhookSecret: ' rotated ',
      maxAttachmentMb: 55,
    })).resolves.toEqual({ success: true });
    await expect(transport.invoke(IPCChannels.Email.GetMailSecuritySettings)).resolves.toEqual(securitySettings);
    await expect(transport.invoke(IPCChannels.Email.SetMailSecuritySettings, {
      rspamdEnabled: true,
      rspamdUrl: ' http://rspamd.local/ ',
      rspamdTimeoutMs: 999,
      spamReviewThreshold: 47.9,
      senderWhitelist: ' trusted@example.com ',
    })).resolves.toEqual({ success: true });
    await expect(transport.invoke(IPCChannels.Email.GetSnoozeSettings)).resolves.toEqual({
      eveningHour: 18,
      eveningMinute: 0,
      morningHour: 9,
      morningMinute: 0,
      nextWeekWeekday: 1,
      nextWeekHour: 9,
      nextWeekMinute: 0,
    });
    await expect(transport.invoke(IPCChannels.Email.SetSnoozeSettings, {
      eveningHour: 18,
      eveningMinute: 0,
      morningHour: 9,
      morningMinute: 5,
      nextWeekWeekday: 1,
      nextWeekHour: 9,
      nextWeekMinute: 30,
    })).resolves.toEqual({ success: true });
    await expect(transport.invoke(IPCChannels.Email.GetReplySuggestionSettings, {
      accountId: 7,
    })).resolves.toEqual({
      autoEnabled: true,
      triggerOnInbound: true,
      triggerOnOpen: false,
      categoryMode: 'only_listed',
      categoryIds: [4, 5],
    });
    await expect(transport.invoke(IPCChannels.Email.SetReplySuggestionSettings, {
      accountId: 7,
      autoEnabled: false,
      triggerOnInbound: true,
      triggerOnOpen: true,
      categoryMode: 'only_listed',
      categoryIds: [5, 5],
    })).resolves.toEqual({
      autoEnabled: false,
      triggerOnInbound: true,
      triggerOnOpen: true,
      categoryMode: 'only_listed',
      categoryIds: [5],
    });
    await expect(transport.invoke(IPCChannels.Email.ListUidValidityNotices)).resolves.toEqual([
      {
        id: '1:100',
        accountId: 1,
        folderPath: 'INBOX',
        oldValidity: '1',
        newValidity: '2',
        messageCount: 5,
        backedUpCount: 3,
        at: '2026-06-03T10:00:00.000Z',
      },
    ]);
    await expect(transport.invoke(IPCChannels.Email.DismissUidValidityNotice, {
      noticeId: '1:100',
    })).resolves.toEqual({ success: true });
    await expect(transport.invoke(IPCChannels.Email.ListImapAuthNotices)).resolves.toEqual([
      {
        accountId: 5,
        message: 'OAuth refresh failed',
        at: '2026-06-03T11:00:00.000Z',
      },
    ]);
    await expect(transport.invoke(IPCChannels.Email.DismissImapAuthNotice, {
      accountId: 5,
    })).resolves.toEqual({ success: true });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/workflow/settings/automation',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/workflow/settings/automation',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          imapDeleteOptIn: false,
          httpAllowlist: 'hooks.example.com',
          spamScoreThreshold: '100',
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      'https://crm.example.com/api/v1/email/settings/misc',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      'https://crm.example.com/api/v1/email/settings/misc',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          webhookSecret: 'rotated',
          maxAttachmentMb: 55,
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      5,
      'https://crm.example.com/api/v1/email/settings/security',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      6,
      'https://crm.example.com/api/v1/email/settings/security',
      expect.objectContaining({
        method: 'PATCH',
      }),
    );
    expect(JSON.parse((fetchImpl.mock.calls[5]?.[1] as RequestInit).body as string)).toEqual({
      rspamdEnabled: true,
      rspamdUrl: 'http://rspamd.local',
      rspamdTimeoutMs: 1000,
      spamReviewThreshold: 47,
      senderWhitelist: 'trusted@example.com',
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      7,
      'https://crm.example.com/api/v1/email/settings/snooze',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      8,
      'https://crm.example.com/api/v1/email/settings/snooze',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          eveningHour: 18,
          eveningMinute: 0,
          morningHour: 9,
          morningMinute: 5,
          nextWeekWeekday: 1,
          nextWeekHour: 9,
          nextWeekMinute: 30,
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      9,
      'https://crm.example.com/api/v1/email/settings/reply-suggestion?accountId=7',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      10,
      'https://crm.example.com/api/v1/email/settings/reply-suggestion',
      expect.objectContaining({ method: 'PATCH' }),
    );
    expect(JSON.parse((fetchImpl.mock.calls[9]?.[1] as RequestInit).body as string)).toEqual({
      accountId: 7,
      autoEnabled: false,
      triggerOnInbound: true,
      triggerOnOpen: true,
      categoryMode: 'only_listed',
      categoryIds: [5],
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      11,
      'https://crm.example.com/api/v1/email/notices/uid-validity',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      12,
      'https://crm.example.com/api/v1/email/notices/uid-validity?noticeId=1%3A100',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      13,
      'https://crm.example.com/api/v1/email/notices/imap-auth',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      14,
      'https://crm.example.com/api/v1/email/notices/imap-auth?accountId=5',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  test('maps incoming webhook workflow test to server enqueue route', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          success: true,
          queued: true,
          fired: 2,
        },
      }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
      getAccessToken: () => 'token-123',
    });

    await expect(transport.invoke(IPCChannels.Email.FireWebhookWorkflow, {
      secret: ' secret-1 ',
      body: { test: true, source: 'settings-panel' },
    })).resolves.toEqual({
      success: true,
      queued: true,
      fired: 2,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/workflows/webhook/incoming',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer token-123',
        }),
        body: JSON.stringify({
          secret: 'secret-1',
          body: { test: true, source: 'settings-panel' },
        }),
      }),
    );
  });

  test('maps rspamd connection test to server settings route', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          success: true,
          message: 'Rspamd erreichbar (http://rspamd.local)',
        },
      }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
      getAccessToken: () => 'token-123',
    });

    await expect(transport.invoke(IPCChannels.Email.TestRspamdConnection, {
      rspamdUrl: ' http://rspamd.local/ ',
      rspamdTimeoutMs: 999,
    })).resolves.toEqual({
      success: true,
      message: 'Rspamd erreichbar (http://rspamd.local)',
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/email/settings/security/test-rspamd',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          rspamdUrl: 'http://rspamd.local',
          rspamdTimeoutMs: 1000,
        }),
      }),
    );
  });

  test('maps email account signatures through account-aware server routes', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [
            {
              sourceSqliteId: -71,
              accountSourceSqliteId: 1,
              accountId: 101,
              signatureHtml: '<p>Shop 1</p>',
              updatedAt: '2026-06-03T10:00:00.000Z',
            },
          ],
          nextCursor: null,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [
            {
              id: 101,
              sourceSqliteId: 1,
              displayName: 'Shop 1',
              emailAddress: 'shop1@example.com',
              protocol: 'imap',
              imapHost: 'imap.example.com',
              imapPort: 993,
              imapTls: true,
              imapUsername: 'shop1@example.com',
              smtpTls: true,
              smtpUseImapAuth: true,
              pop3Tls: true,
              imapSyncSeenOnOpen: true,
              updatedAt: '2026-06-03T10:00:00.000Z',
            },
            {
              id: 102,
              sourceSqliteId: 2,
              displayName: 'Shop 2',
              emailAddress: 'shop2@example.com',
              protocol: 'imap',
              imapHost: 'imap2.example.com',
              imapPort: 993,
              imapTls: true,
              imapUsername: 'shop2@example.com',
              smtpTls: true,
              smtpUseImapAuth: true,
              pop3Tls: true,
              imapSyncSeenOnOpen: true,
              updatedAt: '2026-06-03T10:00:00.000Z',
            },
          ],
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: { sourceSqliteId: -71, accountSourceSqliteId: 1, signatureHtml: '<p>Updated</p>' },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: { success: true, deleted: true },
      }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.ListAccountSignatures)).resolves.toEqual([
      {
        account_id: 1,
        display_name: 'Shop 1',
        email_address: 'shop1@example.com',
        signature_html: '<p>Shop 1</p>',
      },
      {
        account_id: 2,
        display_name: 'Shop 2',
        email_address: 'shop2@example.com',
        signature_html: null,
      },
    ]);
    await expect(transport.invoke(IPCChannels.Email.SaveAccountSignature, {
      accountId: 1,
      signatureHtml: ' <p>Updated</p> ',
    })).resolves.toEqual({ success: true });
    await expect(transport.invoke(IPCChannels.Email.SaveAccountSignature, {
      accountId: 1,
      signatureHtml: '   ',
    })).resolves.toEqual({ success: true });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/email/account-signatures?limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/email/accounts',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      'https://crm.example.com/api/v1/email/account-signatures/by-account/1/upsert',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ signatureHtml: '<p>Updated</p>' }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      'https://crm.example.com/api/v1/email/account-signatures/by-account/1/upsert',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ signatureHtml: null }),
      }),
    );
  });

  test('maps workflow list channel to legacy rows over server HTTP', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({
      data: {
        items: [
          {
            id: 201,
            sourceSqliteId: 11,
            name: 'Outbound guard',
            triggerName: 'outbound',
            enabled: true,
            priority: 250,
            definition: { nodes: [{ id: 'start' }], edges: [] },
            graph: { version: 1 },
            cronExpr: null,
            scheduleAccountSourceSqliteId: 3,
            scheduleAccountId: 103,
            executionMode: 'graph',
            engineVersion: 2,
            legacyCreatedByUserId: 'legacy-user',
            createdByUserId: 'user-1',
            createdAt: '2026-06-03T09:00:00.000Z',
            updatedAt: '2026-06-03T10:00:00.000Z',
          },
        ],
        nextCursor: null,
      },
    }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.ListWorkflows)).resolves.toEqual([
      expect.objectContaining({
        id: 11,
        source_sqlite_id: 11,
        name: 'Outbound guard',
        trigger: 'outbound',
        trigger_name: 'outbound',
        enabled: 1,
        priority: 250,
        definition_json: JSON.stringify({ nodes: [{ id: 'start' }], edges: [] }),
        graph_json: JSON.stringify({ version: 1 }),
        schedule_account_id: 3,
        execution_mode: 'graph',
        engine_version: 2,
        created_at: '2026-06-03T09:00:00.000Z',
        updated_at: '2026-06-03T10:00:00.000Z',
      }),
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/workflows?limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('maps scoped account list payloads to server account query', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { items: [], nextCursor: null } }))
      .mockResolvedValueOnce(jsonResponse({ data: { items: [], nextCursor: null } }))
      .mockResolvedValueOnce(jsonResponse({ data: { items: [], nextCursor: null } }))
      .mockResolvedValueOnce(jsonResponse({ data: { items: [], nextCursor: null } }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.ListWorkflows, { accountId: 7 })).resolves.toEqual([]);
    await expect(transport.invoke(IPCChannels.Email.ListKnowledgeBases, { accountId: 7 })).resolves.toEqual([]);
    await expect(transport.invoke(IPCChannels.Email.ListCannedResponses, { accountId: 7 })).resolves.toEqual([]);
    await expect(transport.invoke(IPCChannels.Email.ListAiPrompts, { accountId: 7 })).resolves.toEqual([]);

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/workflows?limit=100&accountId=7',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/workflow-knowledge-bases?limit=100&accountId=7',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      'https://crm.example.com/api/v1/email/canned-responses?limit=100&accountId=7',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      'https://crm.example.com/api/v1/ai/prompts?limit=100&accountId=7',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('maps workflow CRUD and version channels through source-id server routes', async () => {
    const workflow = {
      id: 201,
      sourceSqliteId: -23,
      name: 'Inbound triage',
      triggerName: 'inbound',
      enabled: true,
      priority: 100,
      definition: { nodes: [{ id: 'start' }] },
      graph: { nodes: [{ id: 'trigger' }], edges: [] },
      cronExpr: null,
      scheduleAccountSourceSqliteId: null,
      scheduleAccountId: null,
      executionMode: 'graph',
      engineVersion: 1,
      createdAt: '2026-06-03T09:00:00.000Z',
      updatedAt: '2026-06-03T10:00:00.000Z',
    };
    const version = {
      id: 301,
      sourceSqliteId: -82,
      workflowSourceSqliteId: -23,
      workflowId: 201,
      label: 'Vor Speichern',
      graph: { nodes: [{ id: 'trigger' }], edges: [] },
      definition: { nodes: [{ id: 'start' }] },
      createdAt: '2026-06-03T11:00:00.000Z',
      updatedAt: '2026-06-03T11:00:00.000Z',
    };
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: workflow }))
      .mockResolvedValueOnce(jsonResponse({ data: workflow }))
      .mockResolvedValueOnce(jsonResponse({ data: workflow }))
      .mockResolvedValueOnce(jsonResponse({ data: version }))
      .mockResolvedValueOnce(jsonResponse({ data: { items: [version], nextCursor: null } }))
      .mockResolvedValueOnce(jsonResponse({ data: { success: true, workflowId: -23 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { deleted: true, workflow } }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.CreateWorkflow, {
      name: 'Inbound triage',
      trigger: 'inbound',
      priority: 100,
      definitionJson: JSON.stringify({ nodes: [{ id: 'start' }] }),
      graphJson: JSON.stringify({ nodes: [{ id: 'trigger' }], edges: [] }),
      enabled: true,
    })).resolves.toEqual({ success: true, id: -23 });
    await expect(transport.invoke(IPCChannels.Email.GetWorkflow, -23)).resolves.toEqual(
      expect.objectContaining({ id: -23, trigger: 'inbound' }),
    );
    await expect(transport.invoke(IPCChannels.Email.UpdateWorkflow, {
      id: -23,
      name: 'Inbound triage updated',
      trigger: 'manual',
      definitionJson: JSON.stringify({ nodes: [{ id: 'manual' }] }),
      graphJson: null,
      cronExpr: null,
      scheduleAccountId: null,
      enabled: false,
    })).resolves.toEqual({ success: true });
    await expect(transport.invoke(IPCChannels.Email.SaveWorkflowVersion, {
      workflowId: -23,
      label: 'Vor Speichern',
    })).resolves.toEqual({ success: true, id: -82 });
    await expect(transport.invoke(IPCChannels.Email.ListWorkflowVersions, -23)).resolves.toEqual([
      expect.objectContaining({
        id: -82,
        workflow_id: -23,
        label: 'Vor Speichern',
        graph_json: JSON.stringify({ nodes: [{ id: 'trigger' }], edges: [] }),
        definition_json: JSON.stringify({ nodes: [{ id: 'start' }] }),
      }),
    ]);
    await expect(transport.invoke(IPCChannels.Email.RestoreWorkflowVersion, {
      versionId: -82,
      workflowId: -23,
    })).resolves.toEqual({ success: true });
    await expect(transport.invoke(IPCChannels.Email.DeleteWorkflow, -23)).resolves.toEqual({ success: true });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/workflows',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          name: 'Inbound triage',
          triggerName: 'inbound',
          priority: 100,
          definition: { nodes: [{ id: 'start' }] },
          graph: { nodes: [{ id: 'trigger' }], edges: [] },
          enabled: true,
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/workflows/by-source/-23',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      'https://crm.example.com/api/v1/workflows/by-source/-23',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          name: 'Inbound triage updated',
          triggerName: 'manual',
          definition: { nodes: [{ id: 'manual' }] },
          graph: null,
          cronExpr: null,
          scheduleAccountId: null,
          enabled: false,
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      'https://crm.example.com/api/v1/workflows/by-source/-23/versions/snapshot',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ label: 'Vor Speichern' }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      5,
      'https://crm.example.com/api/v1/workflows/by-source/-23/versions?limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      6,
      'https://crm.example.com/api/v1/workflow-versions/by-source/-82/restore',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ workflowId: -23 }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      7,
      'https://crm.example.com/api/v1/workflows/by-source/-23',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  test('maps workflow execute to the server execute route', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          success: true,
          queued: true,
          status: 'queued',
          workflowId: -23,
          messageId: 11,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          success: true,
          dryRun: true,
          workflowId: -23,
          messageId: 11,
          status: 'ok',
          blocked: false,
          blockReason: null,
          log: ['dry_run:server'],
        },
      }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.ExecuteWorkflowNow, {
      workflowId: -23,
      messageId: 11,
      dryRun: false,
    })).resolves.toEqual({
      success: true,
      queued: true,
      status: 'queued',
      workflowId: -23,
      messageId: 11,
    });
    await expect(transport.invoke(IPCChannels.Email.ExecuteWorkflowNow, {
      workflowId: -23,
      messageId: 11,
      dryRun: true,
    })).resolves.toEqual({
      success: true,
      dryRun: true,
      workflowId: -23,
      messageId: 11,
      status: 'ok',
      blocked: false,
      blockReason: null,
      log: ['dry_run:server'],
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/workflows/by-source/-23/execute',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ messageId: 11, dryRun: false }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/workflows/by-source/-23/execute',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ messageId: 11, dryRun: true }),
      }),
    );
  });

  test('maps workflow test-on-message to the server dry-run route', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({
      data: {
        success: true,
        dryRun: true,
        workflowId: -23,
        messageId: 11,
        status: 'ok',
        blocked: false,
        blockReason: null,
        log: ['dry_run:server'],
      },
    }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.TestWorkflowOnMessage, {
      workflowId: -23,
      messageId: 11,
      dryRun: true,
    })).resolves.toEqual({
      success: true,
      dryRun: true,
      workflowId: -23,
      messageId: 11,
      status: 'ok',
      blocked: false,
      blockReason: null,
      log: ['dry_run:server'],
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/workflows/by-source/-23/execute',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ messageId: 11, dryRun: true }),
      }),
    );
  });

  test('maps workflow bundle import and export channels to server workflow routes', async () => {
    const workflow = {
      id: 201,
      sourceSqliteId: -23,
      name: 'Inbound triage',
      triggerName: 'manual',
      enabled: true,
      priority: 7,
      definition: { version: 1, rules: [] },
      graph: { version: 1, nodes: [], edges: [] },
      cronExpr: null,
      scheduleAccountSourceSqliteId: null,
      scheduleAccountId: null,
      executionMode: 'graph',
      engineVersion: 1,
      createdAt: '2026-06-03T09:00:00.000Z',
      updatedAt: '2026-06-03T10:00:00.000Z',
    };
    const importJson = JSON.stringify({
      version: 1,
      exportedAt: '2026-06-03T12:00:00.000Z',
      workflow: {
        name: 'Imported workflow',
        trigger: 'manual',
        priority: 5,
        enabled: true,
        definition_json: '{"version":1,"rules":[]}',
        graph_json: null,
        cron_expr: null,
        schedule_account_id: null,
        execution_mode: 'graph',
        engine_version: 1,
      },
    });
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: workflow }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          ...workflow,
          id: 202,
          sourceSqliteId: -24,
          name: 'Imported workflow (Import)',
        },
      }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.ExportWorkflowBundle, -23)).resolves.toMatchObject({
      success: true,
      bundle: {
        version: 1,
        workflow: {
          name: 'Inbound triage',
          trigger: 'manual',
          priority: 7,
          definition_json: '{"version":1,"rules":[]}',
          graph_json: { version: 1, nodes: [], edges: [] },
        },
      },
    });
    await expect(transport.invoke(IPCChannels.Email.ImportWorkflowBundle, {
      json: importJson,
    })).resolves.toEqual({ success: true, id: -24 });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/workflows/by-source/-23',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/workflows',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          name: 'Imported workflow (Import)',
          triggerName: 'manual',
          priority: 5,
          definition: { version: 1, rules: [] },
          graph: null,
          cronExpr: null,
          scheduleAccountId: null,
          enabled: true,
          executionMode: 'graph',
          engineVersion: 1,
        }),
      }),
    );
  });

  test('maps workflow inbound backfill to the server backfill route', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({
      data: {
        success: true,
        messages: 3,
        workflows: 2,
        queued: 6,
        clearedApplied: 4,
      },
    }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.BackfillInboundWorkflows, {
      limit: 25,
      clearApplied: false,
    })).resolves.toEqual({
      success: true,
      processed: 3,
      workflows: 2,
      queued: 6,
      clearedApplied: 4,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/workflows/inbound/backfill',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ limit: 25, clearApplied: false }),
      }),
    );
  });

  test('maps workflow template list channel to server route', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({
      data: [
        {
          id: 'manual-ping-log',
          name: 'Manuell: System-Check',
          description: 'Manueller Trigger',
          trigger: 'manual',
          graph: { version: 1, nodes: [], edges: [] },
        },
      ],
    }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.ListWorkflowTemplates)).resolves.toEqual([
      expect.objectContaining({
        id: 'manual-ping-log',
        trigger: 'manual',
        graph: { version: 1, nodes: [], edges: [] },
      }),
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/workflow/templates',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('maps workflow node catalog channel to server route', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({
      data: [
        {
          type: 'logic.stop',
          label: 'Stopp',
          category: 'logic',
          canvasType: 'action',
        },
        {
          type: 'email.sender_filter',
          label: 'Absender-Filter',
          category: 'email',
          canvasType: 'registry',
          description: 'Whitelist/Blacklist',
          defaultConfig: { useGlobalLists: true },
        },
      ],
    }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.ListWorkflowNodeCatalog)).resolves.toEqual([
      expect.objectContaining({
        type: 'logic.stop',
        label: 'Stopp',
        canvasType: 'action',
      }),
      expect.objectContaining({
        type: 'email.sender_filter',
        defaultConfig: { useGlobalLists: true },
      }),
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/workflow/node-catalog',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('maps workflow plugin list channel to server route', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({ data: [] }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.ListWorkflowPlugins)).resolves.toEqual([]);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/workflow/plugins',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('maps workflow graph compilation channel to server route', async () => {
    const graph = {
      version: 1,
      nodes: [
        { id: 'trigger-1', type: 'trigger', data: { kind: 'inbound' } },
        { id: 'condition-1', type: 'condition', data: { field: 'subject', op: 'contains', value: 'VIP' } },
        { id: 'action-1', type: 'action', data: { actionType: 'tag', tag: 'vip' } },
      ],
      edges: [
        { id: 'edge-1', source: 'trigger-1', target: 'condition-1' },
        { id: 'edge-2', source: 'condition-1', target: 'action-1', label: 'yes' },
      ],
    };
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({
      data: {
        success: true,
        definitionJson: '{"version":1,"rules":[]}',
        registryOnly: false,
      },
    }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.CompileWorkflowGraph, graph)).resolves.toEqual({
      success: true,
      definitionJson: '{"version":1,"rules":[]}',
      registryOnly: false,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/workflows/compile-graph',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(graph),
      }),
    );
  });

  test('maps workflow knowledge base CRUD channels to server routes', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [
            {
              id: 90,
              sourceSqliteId: -90,
              name: 'Returns',
              description: null,
            },
          ],
          nextCursor: null,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 91,
          sourceSqliteId: -91,
          name: 'Shipping',
          description: null,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 92,
          knowledgeBaseId: 91,
          title: 'Policy',
          content: 'Ship fast',
        },
      }))
      .mockResolvedValueOnce(jsonResponse({ data: { deleted: true } }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.ListKnowledgeBases)).resolves.toEqual([{
      id: 90,
      name: 'Returns',
      description: null,
      account_id: null,
      override_key: null,
    }]);
    await expect(transport.invoke(
      IPCChannels.Email.CreateKnowledgeBase,
      { name: 'Shipping' },
    )).resolves.toEqual({ success: true, id: 91 });
    await expect(transport.invoke(
      IPCChannels.Email.AddKnowledgeChunk,
      { knowledgeBaseId: 91, title: 'Policy', content: 'Ship fast' },
    )).resolves.toEqual({ success: true, id: 92 });
    await expect(transport.invoke(IPCChannels.Email.DeleteKnowledgeBase, 91)).resolves.toEqual({ success: true });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/workflow-knowledge-bases?limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/workflow-knowledge-bases',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Shipping' }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      'https://crm.example.com/api/v1/workflow-knowledge-chunks',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ knowledgeBaseId: 91, title: 'Policy', content: 'Ship fast' }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      'https://crm.example.com/api/v1/workflow-knowledge-bases/91',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  test('maps workflow knowledge document channels to server chunk routes', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 90,
          name: 'Returns',
          description: null,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [
            {
              id: 91,
              knowledgeBaseId: 90,
              title: 'Intro',
              content: 'Return policy',
            },
            {
              id: 92,
              knowledgeBaseId: 90,
              title: 'Dokument',
              content: 'Plain text',
            },
          ],
          nextCursor: null,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [
            {
              id: 91,
              knowledgeBaseId: 90,
              title: 'Intro',
              content: 'Old',
            },
            {
              id: 92,
              knowledgeBaseId: 90,
              title: 'Legacy',
              content: 'Remove me',
            },
          ],
          nextCursor: null,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 91,
          knowledgeBaseId: 90,
          title: 'Dokument',
          content: '# Returns\n',
        },
      }))
      .mockResolvedValueOnce(jsonResponse({ data: { deleted: true } }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.GetKnowledgeBaseDocument, 90)).resolves.toEqual({
      success: true,
      content: '## Intro\n\nReturn policy\n\n---\n\nPlain text',
      fileName: '90-returns.md',
    });
    await expect(transport.invoke(
      IPCChannels.Email.SaveKnowledgeBaseDocument,
      { knowledgeBaseId: 90, content: '# Returns\n' },
    )).resolves.toEqual({ success: true });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/workflow-knowledge-bases/90',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/workflow-knowledge-chunks?knowledgeBaseId=90&includeContent=true&limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      'https://crm.example.com/api/v1/workflow-knowledge-chunks?knowledgeBaseId=90&includeContent=true&limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      'https://crm.example.com/api/v1/workflow-knowledge-chunks/91',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          knowledgeBaseId: 90,
          title: 'Dokument',
          content: '# Returns\n',
          sourcePath: null,
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      5,
      'https://crm.example.com/api/v1/workflow-knowledge-chunks/92',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  test('maps workflow run and step channels through source-id server routes', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [
            {
              id: 401,
              sourceSqliteId: -91,
              workflowSourceSqliteId: -23,
              workflowId: 201,
              messageSourceSqliteId: 55,
              messageId: 505,
              direction: 'inbound',
              status: 'succeeded',
              startedAt: '2026-06-03T11:00:00.000Z',
              finishedAt: '2026-06-03T11:00:01.000Z',
              updatedAt: '2026-06-03T11:00:01.000Z',
            },
          ],
          nextCursor: null,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [
            {
              id: 501,
              sourceSqliteId: -101,
              runSourceSqliteId: -91,
              runId: 401,
              nodeId: 'n1',
              nodeType: 'condition',
              status: 'succeeded',
              port: 'yes',
              durationMs: 12,
              message: 'matched',
              createdAt: '2026-06-03T11:00:00.000Z',
              updatedAt: '2026-06-03T11:00:01.000Z',
            },
          ],
          nextCursor: null,
        },
      }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.ListWorkflowRuns, -23)).resolves.toEqual([
      expect.objectContaining({
        id: -91,
        workflow_id: -23,
        message_id: 55,
        direction: 'inbound',
        status: 'succeeded',
        started_at: '2026-06-03T11:00:00.000Z',
        finished_at: '2026-06-03T11:00:01.000Z',
      }),
    ]);
    await expect(transport.invoke(IPCChannels.Email.ListWorkflowRunSteps, -91)).resolves.toEqual([
      expect.objectContaining({
        id: -101,
        run_id: -91,
        node_id: 'n1',
        node_type: 'condition',
        status: 'succeeded',
        port: 'yes',
        duration_ms: 12,
        message: 'matched',
      }),
    ]);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/workflows/by-source/-23/runs?limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/workflow-runs/by-source/-91/steps?limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('maps latest message workflow run lookup through paged server route', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [
            {
              id: 401,
              sourceSqliteId: -91,
              workflowSourceSqliteId: -23,
              messageSourceSqliteId: 55,
              status: 'running',
              startedAt: '2026-06-03T11:00:00.000Z',
              finishedAt: null,
            },
          ],
          nextCursor: 401,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [
            {
              id: 402,
              sourceSqliteId: -92,
              workflowSourceSqliteId: -23,
              messageSourceSqliteId: 55,
              status: 'succeeded',
              startedAt: '2026-06-03T11:10:00.000Z',
              finishedAt: '2026-06-03T11:10:01.000Z',
            },
          ],
          nextCursor: null,
        },
      }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.GetLatestWorkflowRunForMessage, {
      messageId: 55,
    })).resolves.toEqual(expect.objectContaining({
      id: -92,
      workflow_id: -23,
      message_id: 55,
      status: 'succeeded',
      started_at: '2026-06-03T11:10:00.000Z',
      finished_at: '2026-06-03T11:10:01.000Z',
    }));

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/email/messages/55/workflow-runs?limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/email/messages/55/workflow-runs?limit=100&cursor=401',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('maps PGP keyring channels to server HTTP compatibility routes', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [
            {
              id: 41,
              sourceSqliteId: -41,
              email: 'identity@example.com',
              fingerprint: 'abcdefidentity',
              publicKeyArmor: 'public-key',
              hasPrivateKey: true,
              privateKeyConfigured: true,
              isPrimary: true,
              expiresAt: null,
              createdAt: '2026-06-03T10:00:00.000Z',
              updatedAt: '2026-06-03T10:00:00.000Z',
            },
          ],
          nextCursor: null,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({ data: { fingerprint: 'abcdefidentity' } }, 201))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 41,
          sourceSqliteId: -41,
          email: 'identity@example.com',
          fingerprint: 'abcdefidentity',
          publicKeyArmor: 'public-key',
          hasPrivateKey: true,
          privateKeyConfigured: true,
          isPrimary: true,
          expiresAt: null,
          createdAt: '2026-06-03T10:00:00.000Z',
          updatedAt: '2026-06-03T10:05:00.000Z',
        },
      }))
      .mockResolvedValueOnce(jsonResponse({ data: { deleted: true } }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [
            {
              id: 42,
              sourceSqliteId: -42,
              email: 'peer@example.com',
              fingerprint: 'abcdefpeer',
              publicKeyArmor: 'peer-public-key',
              source: 'manual',
              trustLevel: 'imported',
              verifiedAt: null,
              createdAt: '2026-06-03T10:00:00.000Z',
              updatedAt: '2026-06-03T10:00:00.000Z',
            },
          ],
          nextCursor: null,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({ data: { fingerprint: 'abcdefpeer' } }, 201))
      .mockResolvedValueOnce(jsonResponse({ data: { deleted: true } }))
      .mockResolvedValueOnce(jsonResponse({
        data: [
          { email: 'peer@example.com', hasKey: true, fingerprint: 'abcdefpeer' },
          { email: 'missing@example.com', hasKey: false },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: { armored: '-----BEGIN PGP MESSAGE-----\nencrypted' },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: { armored: '-----BEGIN PGP SIGNED MESSAGE-----\nsigned' },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: { text: 'decrypted body', status: 'decrypted' },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: { detected: true, status: 'encrypted_unread' },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: { valid: true, status: 'signed_valid', fingerprint: 'abcdefpeer' },
      }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Pgp.ListIdentities, undefined)).resolves.toEqual([
      expect.objectContaining({
        id: -41,
        source_sqlite_id: -41,
        email: 'identity@example.com',
        fingerprint: 'abcdefidentity',
        has_private_key: 1,
        private_key_configured: 1,
        is_primary: 1,
      }),
    ]);
    await expect(transport.invoke(IPCChannels.Pgp.GenerateIdentity, {
      email: 'identity@example.com',
      passphrase: ' passphrase with spaces ',
    })).resolves.toEqual({ fingerprint: 'abcdefidentity' });
    await expect(transport.invoke(IPCChannels.Pgp.RotateIdentityPassphrase, {
      id: -41,
      currentPassphrase: ' old passphrase with spaces ',
      nextPassphrase: ' new passphrase with spaces ',
    })).resolves.toEqual(expect.objectContaining({
      id: -41,
      private_key_configured: 1,
    }));
    await expect(transport.invoke(IPCChannels.Pgp.DeleteIdentity, { id: -41 })).resolves.toEqual({ success: true });
    await expect(transport.invoke(IPCChannels.Pgp.ListPeerKeys, undefined)).resolves.toEqual([
      expect.objectContaining({
        id: -42,
        source_sqlite_id: -42,
        email: 'peer@example.com',
        fingerprint: 'abcdefpeer',
        trust_level: 'imported',
      }),
    ]);
    await expect(transport.invoke(IPCChannels.Pgp.ImportPeerKey, {
      armored: '-----BEGIN PGP PUBLIC KEY BLOCK-----\npeer\n-----END PGP PUBLIC KEY BLOCK-----',
    })).resolves.toEqual({ fingerprint: 'abcdefpeer' });
    await expect(transport.invoke(IPCChannels.Pgp.DeletePeerKey, { id: -42 })).resolves.toEqual({ success: true });
    await expect(transport.invoke(IPCChannels.Pgp.CheckRecipientKeys, {
      emails: ['peer@example.com', 'missing@example.com'],
    })).resolves.toEqual([
      { email: 'peer@example.com', hasKey: true, fingerprint: 'abcdefpeer' },
      { email: 'missing@example.com', hasKey: false },
    ]);
    await expect(transport.invoke(IPCChannels.Pgp.EncryptMessage, {
      plaintext: '  plaintext with spaces  ',
      recipientEmails: [' peer@example.com '],
    })).resolves.toEqual({ armored: '-----BEGIN PGP MESSAGE-----\nencrypted' });
    await expect(transport.invoke(IPCChannels.Pgp.SignMessage, {
      plaintext: '  signed plaintext  ',
      passphrase: ' passphrase with spaces ',
    })).resolves.toEqual({ armored: '-----BEGIN PGP SIGNED MESSAGE-----\nsigned' });
    await expect(transport.invoke(IPCChannels.Pgp.DecryptMessage, {
      messageId: 41,
      passphrase: ' passphrase with spaces ',
    })).resolves.toEqual({ text: 'decrypted body', status: 'decrypted' });
    await expect(transport.invoke(IPCChannels.Pgp.DetectInbound, {
      messageId: 41,
    })).resolves.toEqual({ success: true });
    await expect(transport.invoke(IPCChannels.Pgp.VerifyMessage, {
      messageId: 41,
    })).resolves.toEqual({ valid: true, status: 'signed_valid', fingerprint: 'abcdefpeer' });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/pgp/identities?limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/pgp/identities/generate',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'identity@example.com',
          passphrase: ' passphrase with spaces ',
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      'https://crm.example.com/api/v1/pgp/identities/by-source/-41/private-key/passphrase',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          currentPassphrase: ' old passphrase with spaces ',
          nextPassphrase: ' new passphrase with spaces ',
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      'https://crm.example.com/api/v1/pgp/identities/by-source/-41',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      5,
      'https://crm.example.com/api/v1/pgp/peer-keys?limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      6,
      'https://crm.example.com/api/v1/pgp/peer-keys/import',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          armored: '-----BEGIN PGP PUBLIC KEY BLOCK-----\npeer\n-----END PGP PUBLIC KEY BLOCK-----',
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      7,
      'https://crm.example.com/api/v1/pgp/peer-keys/by-source/-42',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      8,
      `https://crm.example.com/api/v1/pgp/recipient-key-status?emails=${encodeURIComponent(JSON.stringify(['peer@example.com', 'missing@example.com']))}`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      9,
      'https://crm.example.com/api/v1/pgp/messages/encrypt',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          plaintext: '  plaintext with spaces  ',
          recipientEmails: ['peer@example.com'],
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      10,
      'https://crm.example.com/api/v1/pgp/messages/sign',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          plaintext: '  signed plaintext  ',
          passphrase: ' passphrase with spaces ',
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      11,
      'https://crm.example.com/api/v1/pgp/messages/41/decrypt',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ passphrase: ' passphrase with spaces ' }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      12,
      'https://crm.example.com/api/v1/pgp/messages/41/detect',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      13,
      'https://crm.example.com/api/v1/pgp/messages/41/verify',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('maps PGP plaintext attachment payloads to server HTTP routes', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          armored: 'encrypted-body',
          attachments: [{
            filename: 'invoice.pdf.pgp',
            contentType: 'application/pgp-encrypted',
            contentBase64: 'ZW5jcnlwdGVk',
          }],
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          armored: 'signed-body',
          attachments: [{
            filename: 'note.txt.asc',
            contentType: 'application/pgp-signature',
            contentBase64: 'c2lnbmVk',
          }],
        },
      }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Pgp.EncryptMessage, {
      plaintext: 'hello',
      recipientEmails: [' peer@example.com '],
      attachments: [{
        filename: ' invoice.pdf ',
        contentType: ' application/pdf ',
        contentBase64: 'aW52b2ljZQ==',
      }],
    })).resolves.toEqual({
      armored: 'encrypted-body',
      attachments: [{
        filename: 'invoice.pdf.pgp',
        contentType: 'application/pgp-encrypted',
        contentBase64: 'ZW5jcnlwdGVk',
      }],
    });
    await expect(transport.invoke(IPCChannels.Pgp.SignMessage, {
      plaintext: 'hello',
      passphrase: ' passphrase ',
      attachments: [{
        filename: 'note.txt',
        contentBase64: 'bm90ZQ==',
      }],
    })).resolves.toEqual({
      armored: 'signed-body',
      attachments: [{
        filename: 'note.txt.asc',
        contentType: 'application/pgp-signature',
        contentBase64: 'c2lnbmVk',
      }],
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/pgp/messages/encrypt',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual({
      plaintext: 'hello',
      recipientEmails: ['peer@example.com'],
      attachments: [{
        filename: 'invoice.pdf',
        contentBase64: 'aW52b2ljZQ==',
        contentType: 'application/pdf',
      }],
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/pgp/messages/sign',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body))).toEqual({
      plaintext: 'hello',
      passphrase: ' passphrase ',
      attachments: [{
        filename: 'note.txt',
        contentBase64: 'bm90ZQ==',
      }],
    });
  });

  test('maps email message tag channels to server metadata HTTP routes', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [
            { id: 5, messageId: 11, tag: 'Priority' },
            { id: 6, messageId: 11, tag: 'Werbung' },
          ],
          nextCursor: null,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: { id: 7, messageId: 11, tag: 'Priority Tag' },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: { deleted: true, tag: { id: 7, messageId: 11, tag: 'Priority Tag' } },
      }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.ListMessageTags, 11)).resolves.toEqual([
      'Priority',
      'Werbung',
    ]);
    await expect(transport.invoke(IPCChannels.Email.AddMessageTag, {
      messageId: 11,
      tag: ' Priority Tag ',
    })).resolves.toEqual({ success: true });
    await expect(transport.invoke(IPCChannels.Email.RemoveMessageTag, {
      messageId: 11,
      tag: ' Priority Tag ',
    })).resolves.toEqual({ success: true });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/email/messages/11/tags?limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/email/messages/11/tags',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ tag: 'Priority Tag' }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      'https://crm.example.com/api/v1/email/messages/11/tags?tag=Priority+Tag',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  test('maps single message category channels to server assignment HTTP routes', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [
            { id: 21, messageId: 11, categoryId: 61 },
            { id: 22, messageId: 11, categoryId: 62 },
          ],
          nextCursor: null,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [
            { id: 21, messageId: 11, categoryId: 61 },
            { id: 22, messageId: 11, categoryId: 62 },
          ],
          nextCursor: null,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: { deleted: true, messageCategory: { id: 21 } },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: { deleted: true, messageCategory: { id: 22 } },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: { id: 23, messageId: 11, categoryId: 63 },
      }, 201))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [
            { id: 23, messageId: 11, categoryId: 63 },
          ],
          nextCursor: null,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: { deleted: true, messageCategory: { id: 23 } },
      }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.GetMessageCategory, 11)).resolves.toEqual({
      categoryId: 61,
    });
    await expect(transport.invoke(IPCChannels.Email.SetMessageCategory, {
      messageId: 11,
      categoryId: 63,
    })).resolves.toEqual({ success: true });
    await expect(transport.invoke(IPCChannels.Email.SetMessageCategory, {
      messageId: 11,
      categoryId: null,
    })).resolves.toEqual({ success: true });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/email/messages/11/categories?limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/email/messages/11/categories?limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      'https://crm.example.com/api/v1/email/message-categories/21',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      'https://crm.example.com/api/v1/email/message-categories/22',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      5,
      'https://crm.example.com/api/v1/email/messages/11/categories',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ categoryId: 63 }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      6,
      'https://crm.example.com/api/v1/email/messages/11/categories?limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      7,
      'https://crm.example.com/api/v1/email/message-categories/23',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  test('email category multi-assignment: list / add (idempotent) / remove / set', async () => {
    const fetchImpl = jest
      .fn()
      // ListMessageCategories
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [
            { id: 21, messageId: 11, categoryId: 61 },
            { id: 22, messageId: 11, categoryId: 62 },
          ],
          nextCursor: null,
        },
      }))
      // AddMessageCategory: not yet assigned (62 NOT yet present) → list, then POST
      .mockResolvedValueOnce(jsonResponse({
        data: { items: [{ id: 21, messageId: 11, categoryId: 61 }], nextCursor: null },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: { id: 22, messageId: 11, categoryId: 62 },
      }, 201))
      // AddMessageCategory: already assigned (62 already present) → list only, no POST
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [
            { id: 21, messageId: 11, categoryId: 61 },
            { id: 22, messageId: 11, categoryId: 62 },
          ],
          nextCursor: null,
        },
      }))
      // RemoveMessageCategory: list to find the junction row id, then DELETE
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [
            { id: 21, messageId: 11, categoryId: 61 },
            { id: 22, messageId: 11, categoryId: 62 },
          ],
          nextCursor: null,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: { deleted: true, messageCategory: { id: 22 } },
      }))
      // SetMessageCategories: diff (keep 61, remove 62, add 63) → list, DELETE 22, POST 63
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [
            { id: 21, messageId: 11, categoryId: 61 },
            { id: 22, messageId: 11, categoryId: 62 },
          ],
          nextCursor: null,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: { deleted: true, messageCategory: { id: 22 } },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: { id: 23, messageId: 11, categoryId: 63 },
      }, 201));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    // 1. list
    await expect(transport.invoke(IPCChannels.Email.ListMessageCategories, 11)).resolves.toEqual([
      { id: 21, messageId: 11, categoryId: 61 },
      { id: 22, messageId: 11, categoryId: 62 },
    ]);

    // 2. add new category
    await expect(transport.invoke(IPCChannels.Email.AddMessageCategory, {
      messageId: 11,
      categoryId: 62,
    })).resolves.toEqual({ added: true, record: { id: 22, messageId: 11, categoryId: 62 } });

    // 3. add already-assigned: idempotent, no POST issued
    await expect(transport.invoke(IPCChannels.Email.AddMessageCategory, {
      messageId: 11,
      categoryId: 62,
    })).resolves.toEqual({ added: false, alreadyAssigned: true });

    // 4. remove
    await expect(transport.invoke(IPCChannels.Email.RemoveMessageCategory, {
      messageId: 11,
      categoryId: 62,
    })).resolves.toEqual({ removed: true });

    // 5. set [61, 63] over current {61, 62} → DELETE 22, POST 63 (keep 21 alone)
    await expect(transport.invoke(IPCChannels.Email.SetMessageCategories, {
      messageId: 11,
      categoryIds: [61, 63],
    })).resolves.toEqual({ success: true });

    // The 3rd Add call (already-assigned) must NOT have triggered a POST.
    const postsToCategories = fetchImpl.mock.calls
      .map((args: unknown[]) => args[1] as { method?: string } | undefined)
      .filter((init) => init?.method === 'POST').length;
    // Expected: 2 POSTs total (add-new + set-add 63). Set-diff keeps 61 unchanged.
    expect(postsToCategories).toBe(2);
  });

  test('AddMessageCategory treats POST 409 as already assigned (race after GET pre-check)', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        data: { items: [{ id: 21, messageId: 11, categoryId: 61 }], nextCursor: null },
      }))
      .mockResolvedValueOnce(jsonResponse({
        error: { code: 'conflict', message: 'Category already assigned' },
      }, 409));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.AddMessageCategory, {
      messageId: 11,
      categoryId: 62,
    })).resolves.toEqual({ added: false, alreadyAssigned: true });
  });

  test('maps message customer-link and assignment channels to server message metadata routes', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { id: 11, customerId: 42 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 11, assignedTo: 'agent-1' } }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.LinkCustomer, {
      messageId: 11,
      customerId: 42,
    })).resolves.toEqual({ success: true });
    await expect(transport.invoke(IPCChannels.Email.AssignMessage, {
      messageId: 11,
      teamMemberId: 'agent-1',
    })).resolves.toEqual({ success: true });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/email/messages/11/customer-link',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ customerId: 42 }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/email/messages/11/assignment',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ teamMemberId: 'agent-1' }),
      }),
    );
  });

  test('maps email internal note channels to server metadata HTTP routes', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [
            {
              id: 8,
              messageId: 11,
              body: 'Follow up',
              createdAt: '2026-06-03T10:00:00.000Z',
              updatedAt: '2026-06-03T10:00:00.000Z',
            },
          ],
          nextCursor: null,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: { id: 9, messageId: 11, body: 'New note' },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: { id: 8, messageId: 11, body: 'Updated note' },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: { deleted: true, internalNote: { id: 8, messageId: 11 } },
      }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.ListInternalNotes, 11)).resolves.toEqual([
      {
        id: 8,
        body: 'Follow up',
        created_at: '2026-06-03T10:00:00.000Z',
      },
    ]);
    await expect(transport.invoke(IPCChannels.Email.AddInternalNote, {
      messageId: 11,
      body: ' New note ',
    })).resolves.toEqual({ success: true });
    await expect(transport.invoke(IPCChannels.Email.UpdateInternalNote, {
      noteId: 8,
      body: ' Updated note ',
    })).resolves.toEqual({ success: true });
    await expect(transport.invoke(IPCChannels.Email.DeleteInternalNote, 8)).resolves.toEqual({
      success: true,
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/email/messages/11/internal-notes?limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/email/messages/11/internal-notes',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ body: 'New note' }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      'https://crm.example.com/api/v1/email/internal-notes/8',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ body: 'Updated note' }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      'https://crm.example.com/api/v1/email/internal-notes/8',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  test('maps email canned response channels to server metadata HTTP routes', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [
            {
              id: 12,
              title: 'Shipping',
              body: 'Your package ships today.',
              sortOrder: 1,
            },
          ],
          nextCursor: null,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: { id: 13, title: 'Neu', body: '' },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: { id: 12, title: 'Shipping update', body: 'Updated body' },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: { deleted: true, cannedResponse: { id: 12 } },
      }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.ListCannedResponses)).resolves.toEqual([
      {
        id: 12,
        title: 'Shipping',
        body: 'Your package ships today.',
        account_id: null,
        override_key: null,
      },
    ]);
    await expect(transport.invoke(IPCChannels.Email.SaveCannedResponse, {
      title: 'Neu',
      body: '',
    })).resolves.toEqual({ success: true, id: 13 });
    await expect(transport.invoke(IPCChannels.Email.SaveCannedResponse, {
      id: 12,
      title: 'Shipping update',
      body: 'Updated body',
    })).resolves.toEqual({ success: true, id: 12 });
    await expect(transport.invoke(IPCChannels.Email.DeleteCannedResponse, 12)).resolves.toEqual({
      success: true,
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/email/canned-responses?limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/email/canned-responses',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ title: 'Neu', body: '' }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      'https://crm.example.com/api/v1/email/canned-responses/12',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ title: 'Shipping update', body: 'Updated body' }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      'https://crm.example.com/api/v1/email/canned-responses/12',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  test('maps email team member channels to server metadata HTTP routes', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [
            {
              id: 'agent-1',
              displayName: 'Agent One',
              role: 'agent',
              signatureHtml: '<p>One</p>',
              sortOrder: 1,
            },
          ],
          nextCursor: null,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'agent 2',
          displayName: 'Agent Two',
          role: 'agent',
          signatureHtml: null,
          sortOrder: 0,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: { deleted: true, teamMember: { id: 'agent-1' } },
      }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.ListTeamMembers)).resolves.toEqual([
      {
        id: 'agent-1',
        display_name: 'Agent One',
        role: 'agent',
        signature_html: '<p>One</p>',
        sort_order: 1,
      },
    ]);
    await expect(transport.invoke(IPCChannels.Email.SaveTeamMember, {
      id: ' agent 2 ',
      displayName: 'Agent Two',
      signatureHtml: null,
    })).resolves.toEqual({ success: true });
    await expect(transport.invoke(IPCChannels.Email.DeleteTeamMember, 'agent-1')).resolves.toEqual({
      success: true,
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/email/team-members?limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/email/team-members/agent%202/upsert',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          displayName: 'Agent Two',
          signatureHtml: null,
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      'https://crm.example.com/api/v1/email/team-members/agent-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  test('maps legacy email AI settings reads to server profile list', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({
      data: {
        items: [
          {
            id: 21,
            sourceSqliteId: -21,
            label: 'OpenAI',
            provider: 'openai',
            baseUrl: 'https://api.openai.com/v1',
            model: 'gpt-4.1',
            embeddingModel: 'text-embedding-3-small',
            isDefault: false,
            sortOrder: 0,
            apiKeyConfigured: true,
          },
          {
            id: 22,
            label: 'Default',
            provider: 'openrouter',
            baseUrl: 'https://openrouter.ai/api/v1',
            model: 'openai/gpt-4o-mini',
            embeddingModel: 'openai/text-embedding-3-small',
            isDefault: true,
            sortOrder: 1,
            apiKeyConfigured: false,
          },
        ],
        nextCursor: null,
      },
    }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.GetAiSettings)).resolves.toMatchObject({
      success: true,
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'openai/gpt-4o-mini',
      embeddingModel: 'openai/text-embedding-3-small',
      profiles: [
        expect.objectContaining({
          id: 21,
          hasApiKey: true,
          base_url: 'https://api.openai.com/v1',
        }),
        expect.objectContaining({
          id: 22,
          isDefault: true,
          hasApiKey: false,
        }),
      ],
      providerPresets: expect.objectContaining({
        openai: expect.objectContaining({ defaultModel: expect.any(String) }),
      }),
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/ai/profiles?limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('maps legacy email AI settings writes to default server profile', async () => {
    const defaultProfile = {
      id: 22,
      label: 'Default',
      provider: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'openai/gpt-4o-mini',
      embeddingModel: 'openai/text-embedding-3-small',
      isDefault: true,
      sortOrder: 1,
      apiKeyConfigured: false,
    };
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        data: { items: [defaultProfile], nextCursor: null },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          ...defaultProfile,
          baseUrl: 'https://openrouter.ai/api/v1',
          model: 'openai/gpt-4o-mini',
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: { items: [], nextCursor: null },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 23,
          label: 'Standard',
          provider: 'custom',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          embeddingModel: 'text-embedding-3-small',
          isDefault: true,
          sortOrder: 0,
          apiKeyConfigured: true,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: { items: [defaultProfile], nextCursor: null },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: { ...defaultProfile, apiKeyConfigured: false },
      }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.SetAiSettings, {
      baseUrl: ' https://openrouter.ai/api/v1/ ',
      model: ' openai/gpt-4o-mini ',
    })).resolves.toEqual({ success: true });
    await expect(transport.invoke(IPCChannels.Email.SetAiApiKey, ' sk-new ')).resolves.toEqual({
      success: true,
    });
    await expect(transport.invoke(IPCChannels.Email.ClearAiApiKey)).resolves.toEqual({
      success: true,
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/ai/profiles?limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/ai/profiles/22',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          baseUrl: 'https://openrouter.ai/api/v1',
          model: 'openai/gpt-4o-mini',
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      'https://crm.example.com/api/v1/ai/profiles?limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      'https://crm.example.com/api/v1/ai/profiles',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          label: 'Standard',
          provider: 'custom',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          embeddingModel: 'text-embedding-3-small',
          isDefault: true,
          sortOrder: 0,
          apiKey: 'sk-new',
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      5,
      'https://crm.example.com/api/v1/ai/profiles?limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      6,
      'https://crm.example.com/api/v1/ai/profiles/22',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ apiKey: null }),
      }),
    );
  });

  test('maps email AI profile and prompt channels to server HTTP routes', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [
            {
              id: 21,
              sourceSqliteId: -21,
              label: 'OpenAI',
              provider: 'openai',
              baseUrl: 'https://api.openai.com/v1',
              model: 'gpt-4.1',
              embeddingModel: 'text-embedding-3-small',
              isDefault: true,
              sortOrder: 0,
              apiKeyConfigured: true,
            },
          ],
          nextCursor: null,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 22,
          label: 'Anthropic',
          provider: 'anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          model: 'claude-sonnet-4',
          embeddingModel: null,
          isDefault: false,
          sortOrder: 1,
          apiKeyConfigured: false,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 21,
          label: 'OpenAI',
          provider: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4.1-mini',
          embeddingModel: null,
          isDefault: true,
          sortOrder: 0,
          apiKeyConfigured: true,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({ data: { deleted: true } }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [
            {
              id: 31,
              label: 'Rewrite',
              userTemplate: 'Rewrite {{text}}',
              target: 'full_body',
              profileId: 21,
              sortOrder: 2,
            },
          ],
          nextCursor: null,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 32,
          label: 'New prompt',
          userTemplate: '{{text}}',
          target: 'full_body',
          profileId: null,
          sortOrder: 3,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 31,
          label: 'Rewrite updated',
          userTemplate: 'Update {{text}}',
          target: 'reply',
          profileId: null,
          sortOrder: 2,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [
            { id: 31, label: 'Rewrite updated', userTemplate: 'Update {{text}}', sortOrder: 2 },
            { id: 32, label: 'New prompt', userTemplate: '{{text}}', sortOrder: 3 },
          ],
          nextCursor: null,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          success: true,
          items: [
            { id: 31, label: 'Rewrite updated', userTemplate: 'Update {{text}}', sortOrder: 3 },
            { id: 32, label: 'New prompt', userTemplate: '{{text}}', sortOrder: 2 },
          ],
        },
      }))
      .mockResolvedValueOnce(jsonResponse({ data: { deleted: true } }))
      .mockResolvedValueOnce(jsonResponse({ data: { success: true, text: 'Besserer Text' } }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.ListAiProfiles)).resolves.toEqual([
      expect.objectContaining({
        id: 21,
        label: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        base_url: 'https://api.openai.com/v1',
        isDefault: true,
        is_default: 1,
        hasApiKey: true,
      }),
    ]);
    await expect(transport.invoke(IPCChannels.Email.SaveAiProfile, {
      label: 'Anthropic',
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-sonnet-4',
      embeddingModel: null,
      apiKey: ' sk-test ',
    })).resolves.toEqual({ success: true, id: 22 });
    await expect(transport.invoke(IPCChannels.Email.ClearAiProfileApiKey, 21)).resolves.toEqual({
      success: true,
    });
    await expect(transport.invoke(IPCChannels.Email.DeleteAiProfile, 22)).resolves.toEqual({
      success: true,
    });
    await expect(transport.invoke(IPCChannels.Email.ListAiPrompts)).resolves.toEqual([
      expect.objectContaining({
        id: 31,
        label: 'Rewrite',
        user_template: 'Rewrite {{text}}',
        target: 'full_body',
        profile_id: 21,
        sort_order: 2,
      }),
    ]);
    await expect(transport.invoke(IPCChannels.Email.SaveAiPrompt, {
      label: 'New prompt',
      userTemplate: '{{text}}',
    })).resolves.toEqual({ success: true, id: 32 });
    await expect(transport.invoke(IPCChannels.Email.SaveAiPrompt, {
      id: 31,
      label: 'Rewrite updated',
      userTemplate: 'Update {{text}}',
      profileId: null,
    })).resolves.toEqual({ success: true, id: 31 });
    await expect(transport.invoke(IPCChannels.Email.ReorderAiPrompt, {
      id: 31,
      direction: 'down',
    })).resolves.toEqual({ success: true });
    await expect(transport.invoke(IPCChannels.Email.DeleteAiPrompt, 31)).resolves.toEqual({
      success: true,
    });
    await expect(transport.invoke(IPCChannels.Email.AiTransformText, {
      promptId: 31,
      text: ' Bitte freundlicher ',
      customerId: 7,
    })).resolves.toEqual({ success: true, text: 'Besserer Text' });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/ai/profiles?limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/ai/profiles',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          label: 'Anthropic',
          provider: 'anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          model: 'claude-sonnet-4',
          embeddingModel: null,
          apiKey: ' sk-test ',
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      'https://crm.example.com/api/v1/ai/profiles/21',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ apiKey: null }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      'https://crm.example.com/api/v1/ai/profiles/22',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      5,
      'https://crm.example.com/api/v1/ai/prompts?limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      6,
      'https://crm.example.com/api/v1/ai/prompts',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          label: 'New prompt',
          userTemplate: '{{text}}',
          target: 'full_body',
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      7,
      'https://crm.example.com/api/v1/ai/prompts/31',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          label: 'Rewrite updated',
          userTemplate: 'Update {{text}}',
          profileId: null,
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      8,
      'https://crm.example.com/api/v1/ai/prompts?limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      9,
      'https://crm.example.com/api/v1/ai/prompts/reorder',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          updates: [
            { id: 31, sortOrder: 3 },
            { id: 32, sortOrder: 2 },
          ],
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      10,
      'https://crm.example.com/api/v1/ai/prompts/31',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      11,
      'https://crm.example.com/api/v1/ai/transform-text',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          promptId: 31,
          text: 'Bitte freundlicher',
          customerId: 7,
        }),
      }),
    );
  });

  test('maps email spam list entry channels to server HTTP routes', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [
            {
              id: 41,
              sourceSqliteId: -41,
              listType: 'block',
              patternType: 'domain',
              pattern: 'example.com',
              accountId: null,
              note: 'Noisy sender',
              updatedAt: '2026-06-03T10:00:00.000Z',
            },
          ],
          nextCursor: null,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 42,
          listType: 'allow',
          patternType: 'email',
          pattern: 'user@example.com',
          accountId: null,
          note: null,
        },
      }, 201))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 41,
          listType: 'block',
          patternType: 'domain',
          pattern: 'example.com',
          accountId: null,
          note: 'Updated',
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: { deleted: true, spamListEntry: { id: 41 } },
      }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Email.ListSpamListEntries, 'all')).resolves.toEqual([
      {
        id: 41,
        source_sqlite_id: -41,
        list_type: 'block',
        pattern_type: 'domain',
        pattern: 'example.com',
        account_source_sqlite_id: undefined,
        account_id: null,
        note: 'Noisy sender',
        created_at: undefined,
        updated_at: '2026-06-03T10:00:00.000Z',
      },
    ]);
    await expect(transport.invoke(IPCChannels.Email.SaveSpamListEntry, {
      listType: 'allow',
      pattern: ' User@Example.COM ',
      note: null,
    })).resolves.toEqual({
      success: true,
      entry: expect.objectContaining({
        id: 42,
        list_type: 'allow',
        pattern_type: 'email',
        pattern: 'user@example.com',
      }),
    });
    await expect(transport.invoke(IPCChannels.Email.SaveSpamListEntry, {
      id: 41,
      listType: 'block',
      patternType: 'domain',
      pattern: '.Example.COM.',
      note: 'Updated',
    })).resolves.toEqual({
      success: true,
      entry: expect.objectContaining({
        id: 41,
        pattern: 'example.com',
        note: 'Updated',
      }),
    });
    await expect(transport.invoke(IPCChannels.Email.DeleteSpamListEntry, 41)).resolves.toEqual({
      success: true,
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/spam/list-entries?limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/spam/list-entries/upsert',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          listType: 'allow',
          patternType: 'email',
          pattern: 'user@example.com',
          note: null,
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      'https://crm.example.com/api/v1/spam/list-entries/41',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          listType: 'block',
          patternType: 'domain',
          pattern: 'example.com',
          note: 'Updated',
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      'https://crm.example.com/api/v1/spam/list-entries/41',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  test('maps dashboard channels to server HTTP routes', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          totalCustomers: 10,
          newCustomersLastMonth: 2,
          activeDealsCount: 3,
          activeDealsValue: 5000,
          pendingTasksCount: 4,
          dueTodayTasksCount: 1,
          conversionRate: 25,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: [
          {
            id: 12,
            name: 'ACME',
            email: 'info@example.com',
            dateAdded: '2026-06-03T10:00:00.000Z',
          },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: [
          {
            id: 9,
            title: 'Call back',
            priority: 'High',
            customerId: 12,
            dueDate: '2026-06-04T00:00:00.000Z',
            customerName: 'ACME',
          },
        ],
      }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Dashboard.GetStats)).resolves.toEqual({
      totalCustomers: 10,
      newCustomersLastMonth: 2,
      activeDealsCount: 3,
      activeDealsValue: 5000,
      pendingTasksCount: 4,
      dueTodayTasksCount: 1,
      conversionRate: 25,
    });
    await expect(transport.invoke(IPCChannels.Dashboard.GetRecentCustomers, 5)).resolves.toEqual([
      {
        id: '12',
        name: 'ACME',
        email: 'info@example.com',
        dateAdded: '2026-06-03T10:00:00.000Z',
      },
    ]);
    await expect(transport.invoke(IPCChannels.Dashboard.GetUpcomingTasks, 5)).resolves.toEqual([
      {
        id: 9,
        title: 'Call back',
        priority: 'High',
        customer_id: 12,
        dueDate: '2026-06-04T00:00:00.000Z',
        customerName: 'ACME',
      },
    ]);

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/dashboard/stats',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/dashboard/recent-customers?limit=5',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      'https://crm.example.com/api/v1/dashboard/upcoming-tasks?limit=5',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('maps follow-up queue channels to server HTTP routes', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          heute: 2,
          ueberfaellig: 1,
          dieseWoche: 4,
          zurueckgestellt: 3,
          stagnierend: 5,
          highValueRisk: 6,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: [
          {
            itemId: 7,
            sourceType: 'deal',
            customerId: 3,
            customerName: 'ACME',
            dealId: 12,
            dealName: 'Renewal',
            dealValue: '2400.50',
            dealStage: 'Negotiation',
            title: 'Renewal',
            reason: 'Hoher Wert, Abschluss gefaehrdet',
            dueDate: null,
            priority: 'High',
            priorityScore: '42',
            lastContactDate: '2026-06-02T10:00:00.000Z',
            snoozedUntil: null,
            completed: false,
          },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: [{
          id: 11,
          customerId: 3,
          dealId: null,
          taskId: null,
          activityType: 'email',
          title: 'Angebot gesendet',
          description: null,
          metadata: { imported: true },
          createdAt: '2026-06-03T10:00:00.000Z',
        }],
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: { success: true },
      }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.FollowUp.GetQueueCounts)).resolves.toEqual({
      heute: 2,
      ueberfaellig: 1,
      dieseWoche: 4,
      zurueckgestellt: 3,
      stagnierend: 5,
      highValueRisk: 6,
    });
    await expect(transport.invoke(IPCChannels.FollowUp.GetItems, {
      queue: 'high_value_risk',
      filters: { query: 'ACME', priority: 'High' },
      limit: 20,
      offset: 5,
    })).resolves.toEqual([
      {
        item_id: 7,
        source_type: 'deal',
        customer_id: 3,
        customer_name: 'ACME',
        deal_id: 12,
        deal_name: 'Renewal',
        deal_value: 2400.50,
        deal_stage: 'Negotiation',
        title: 'Renewal',
        reason: 'Hoher Wert, Abschluss gefaehrdet',
        due_date: undefined,
        priority: 'High',
        priority_score: 42,
        last_contact_date: '2026-06-02T10:00:00.000Z',
        snoozed_until: undefined,
        completed: false,
      },
    ]);
    await expect(transport.invoke(IPCChannels.FollowUp.GetTimeline, {
      customerId: 3,
      filter: 'communication',
      limit: 10,
    })).resolves.toEqual([{
      id: 11,
      customer_id: 3,
      deal_id: undefined,
      task_id: undefined,
      activity_type: 'email',
      title: 'Angebot gesendet',
      description: undefined,
      metadata: JSON.stringify({ imported: true }),
      created_at: '2026-06-03T10:00:00.000Z',
    }]);
    await expect(transport.invoke(IPCChannels.FollowUp.SnoozeTask, {
      taskId: 9,
      snoozedUntil: '2026-06-04T10:00:00.000Z',
    })).resolves.toEqual({ success: true });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/follow-up/queue-counts',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/follow-up/items?queue=high_value_risk&limit=20&offset=5&query=ACME&priority=High',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      'https://crm.example.com/api/v1/activity-log?limit=10&customerId=3&sort=createdAtDesc&timelineFilter=communication',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      'https://crm.example.com/api/v1/follow-up/tasks/9/snooze',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ snoozedUntil: '2026-06-04T10:00:00.000Z' }),
      }),
    );
  });

  test('maps JTL sync status and run channels to server routes', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          status: 'Success',
          message: 'Synced',
          timestamp: '2026-06-05T10:00:00.000Z',
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          success: true,
          message: 'Sync completed',
          details: { found: 6, synced: 6 },
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          key: 'lastCustomerSync',
          value: '2026-03-01',
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          success: true,
        },
      }));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Sync.GetStatus)).resolves.toEqual({
      status: 'Success',
      message: 'Synced',
      timestamp: '2026-06-05T10:00:00.000Z',
    });
    await expect(transport.invoke(IPCChannels.Sync.Run)).resolves.toEqual({
      success: true,
      message: 'Sync completed',
      details: { found: 6, synced: 6 },
    });
    await expect(transport.invoke(IPCChannels.Sync.GetInfo, 'lastCustomerSync')).resolves.toBe('2026-03-01');
    await expect(transport.invoke(IPCChannels.Sync.SetInfo, {
      key: 'lastCustomerSync',
      value: '2026-03-16',
    })).resolves.toEqual({ success: true });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://crm.example.com/api/v1/jtl/sync/status',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.com/api/v1/jtl/sync/run',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      'https://crm.example.com/api/v1/sync-info/lastCustomerSync',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      'https://crm.example.com/api/v1/sync-info/lastCustomerSync',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ value: '2026-03-16' }),
      }),
    );
  });

  test('keeps HTTP transport registry coverage explicit for every invoke channel', () => {
    const intentionallyUnsupported = new Set<string>([
      // Native window/update/setup affordances are handled outside server HTTP invoke transport.
      IPCChannels.Window.GetState,
      IPCChannels.Update.CheckForUpdates,
      IPCChannels.Update.InstallUpdate,
      IPCChannels.Update.GetStatus,
      IPCChannels.Update.OpenExternalUrl,
      IPCChannels.Setup.GetDeployConfig,
      IPCChannels.Setup.SaveDeployConfig,

      // Server-client auth uses server-auth-client/AuthProvider instead of legacy invoke mapping.
      IPCChannels.Auth.Login,
      IPCChannels.Auth.Logout,
      IPCChannels.Auth.GetSession,
      IPCChannels.Auth.GetSetupState,
      IPCChannels.Auth.GetOneTimeSetupPassword,
      IPCChannels.Auth.SetInitialPassword,

      // Local automation listener settings remain standalone/Electron-only.
      IPCChannels.Automation.SetSettings,

      // Mail backup, file-picker, attachment save/open dialogs remain local desktop actions.
      IPCChannels.Email.ExportLocalMailBackup,
      IPCChannels.Email.VerifyLocalMailBackup,
      IPCChannels.Email.PickLocalMailBackupZip,
      IPCChannels.Email.PreviewRestoreLocalMailBackup,
      IPCChannels.Email.RestoreLocalMailBackup,
      IPCChannels.Email.PickComposeAttachments,
      IPCChannels.Email.OpenAttachmentPath,
      IPCChannels.Email.SaveAttachmentToDisk,

      // Native workflow/knowledge file-dialog variants remain local; browser mode uses upload/download helpers.
      IPCChannels.Email.ExportWorkflowBundleToFile,
      IPCChannels.Email.ImportWorkflowBundleFromFile,
      IPCChannels.Email.ExportKnowledgeBaseDocument,
      IPCChannels.Email.ImportKnowledgeFile,
    ]);
    const missing = AllowedInvokeChannels
      .filter((channel) => !hasHttpInvocation(channel))
      .filter((channel) => !intentionallyUnsupported.has(channel));

    expect(missing).toEqual([]);
  });

  test('rejects unsupported IPC channels in HTTP mode before fetching', async () => {
    const fetchImpl = jest.fn();
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Window.GetState)).rejects.toThrow(
      'No HTTP transport mapping registered',
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('turns API error bodies into RendererTransportError', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({
      error: {
        code: 'validation_error',
        message: 'Payload invalid',
        details: { field: 'name' },
      },
    }, 400));
    const transport = createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    });

    await expect(transport.invoke(IPCChannels.Db.CreateCustomer, {})).rejects.toMatchObject({
      name: 'RendererTransportError',
      status: 400,
      code: 'validation_error',
      message: 'Payload invalid',
      details: { field: 'name' },
    });
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

function blobResponse(blob: Blob, headers: Record<string, string>, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    blob: async () => blob,
    text: async () => '',
  } as Response;
}
