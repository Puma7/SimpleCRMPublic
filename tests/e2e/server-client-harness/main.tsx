import React from 'react';
import { createRoot } from 'react-dom/client';

import { MailDelegationPanel } from '@/components/email/settings/mail-delegation-panel';
import {
  buildServerAuthSession,
  configureRendererTransport,
  createHttpRendererTransport,
  saveServerAuthSession,
} from '@/services/transport';

const params = new URLSearchParams(window.location.search);
const apiUrl = params.get('apiUrl');
if (!apiUrl) throw new Error('apiUrl is required');

saveServerAuthSession(buildServerAuthSession({
  user: {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    workspaceId: '11111111-1111-4111-8111-111111111111',
    email: 'manager@example.test',
    displayName: 'Delegation Manager',
    role: 'user',
  },
  tokens: {
    accessToken: 'task-7-manager-token',
    refreshToken: 'task-7-manager-refresh-token',
    expiresInSeconds: 3_600,
  },
}), 'task-7-csrf', undefined, undefined, apiUrl);
configureRendererTransport(createHttpRendererTransport({ baseUrl: apiUrl }));

const root = document.getElementById('root');
if (!root) throw new Error('root is required');
createRoot(root).render(<MailDelegationPanel />);
