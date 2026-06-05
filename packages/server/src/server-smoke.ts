import http from 'node:http';

import {
  createNodeHttpHandler,
  createServerApi,
  type ServerApiPorts,
} from './api';
import { parsePort } from './config';
import { createStaticWorkflowNodeCatalogPort } from './workflow-node-catalog';
import { createStaticWorkflowTemplatePort } from './workflow-templates';

export function createSmokeServer() {
  const api = createServerApi(createSmokePorts());
  return http.createServer((req, res) => {
    void createNodeHttpHandler(api)(req, res);
  });
}

if (require.main === module) {
  const port = parsePort(process.env.PORT ?? '3000');
  createSmokeServer().listen(port, '0.0.0.0', () => {
    process.stdout.write(`[simplecrm-server-foundation] listening on ${port}\n`);
  });
}

export function createSmokePorts(): ServerApiPorts {
  return {
    auth: {
      async findUserByEmail() {
        return null;
      },
      async verifyPassword() {
        return false;
      },
      async checkLoginLock() {
        return null;
      },
      async recordFailedLogin() {
        return 1;
      },
      async recordSuccessfulLogin() {
        return undefined;
      },
      async issueTokenPair() {
        throw new Error('auth_not_configured');
      },
      async rotateRefreshToken() {
        return null;
      },
      async revokeRefreshToken() {
        return false;
      },
    },
    locks: {
      async list() {
        return [];
      },
      async acquire() {
        throw new Error('locks_not_configured');
      },
      async get() {
        return null;
      },
      async heartbeat() {
        return null;
      },
      async release() {
        return null;
      },
      async forceTakeover() {
        throw new Error('locks_not_configured');
      },
    },
    workflowNodeCatalog: createStaticWorkflowNodeCatalogPort(),
    workflowTemplates: createStaticWorkflowTemplatePort(),
  };
}
