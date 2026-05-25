/** External Automation API (n8n, scripts) — shared types */

export const AUTOMATION_API_PREFIX = '/api/v1';

export const AUTOMATION_SCOPES = [
  'read',
  'write',
  'email',
  'workflows',
] as const;

export type AutomationScope = (typeof AUTOMATION_SCOPES)[number];

export type AutomationApiSettings = {
  enabled: boolean;
  port: number;
  bindLan: boolean;
  hasApiKey: boolean;
  keyPreview: string | null;
  scopes: AutomationScope[];
};

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export const AUTOMATION_DEFAULT_PORT = 3847;

export const AUTOMATION_MAX_BODY_BYTES = 1024 * 1024;

export const AUTOMATION_RATE_LIMIT_PER_MINUTE = 60;
