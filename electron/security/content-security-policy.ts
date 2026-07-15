export type RendererContentSecurityPolicyInput = Readonly<{
  isDevelopment: boolean;
  devServerUrl?: string;
  serverBaseUrl?: string;
  allowUnconfiguredServer?: boolean;
}>;

export function buildRendererContentSecurityPolicy(
  input: RendererContentSecurityPolicyInput,
): string {
  const connectSources = new Set(["'self'", 'https://challenges.cloudflare.com']);
  addHttpAndSocketOrigins(connectSources, input.serverBaseUrl);
  if (input.allowUnconfiguredServer) {
    connectSources.add('https:');
    connectSources.add('http:');
    connectSources.add('wss:');
    connectSources.add('ws:');
  }
  if (input.isDevelopment) {
    addHttpAndSocketOrigins(connectSources, input.devServerUrl ?? 'http://localhost:5173');
  }

  const scriptSources = ["'self'", 'https://challenges.cloudflare.com'];
  if (input.isDevelopment) scriptSources.push("'unsafe-eval'");

  return [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
    `script-src ${scriptSources.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https: http:",
    "font-src 'self' data:",
    "media-src 'self' data: blob: https: http:",
    "frame-src 'self' blob: https://challenges.cloudflare.com",
    "worker-src 'self' blob:",
    `connect-src ${Array.from(connectSources).join(' ')}`,
    "manifest-src 'self'",
  ].join('; ');
}

function addHttpAndSocketOrigins(target: Set<string>, value: string | undefined): void {
  if (!value?.trim()) return;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
    target.add(parsed.origin);
    const socket = new URL(parsed.origin);
    socket.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
    target.add(socket.origin);
  } catch {
    // Invalid values are ignored; deploy-config validation reports them separately.
  }
}
