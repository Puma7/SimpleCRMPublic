export const MAIL_PRINT_FRAME_NAME = 'simplecrm-mail-print';
export const MAIL_ATTACHMENT_PREVIEW_FRAME_NAME = 'simplecrm-mail-attachment-preview';

export type RendererNavigationPolicy = Readonly<{
  isDevelopment: boolean;
  devServerUrl?: string;
  productionFileUrl?: string;
}>;

export function isAllowedRendererNavigation(
  candidateUrl: string,
  policy: RendererNavigationPolicy,
): boolean {
  const candidate = parseUrl(candidateUrl);
  if (!candidate) return false;

  if (policy.isDevelopment) {
    const devServer = parseUrl(policy.devServerUrl ?? 'http://localhost:5173');
    return Boolean(devServer && candidate.origin === devServer.origin);
  }

  if (candidate.protocol === 'app:' && candidate.hostname === '-') {
    return !candidate.username && !candidate.password && !candidate.port;
  }

  const productionFile = parseUrl(policy.productionFileUrl);
  return Boolean(
    productionFile
    && candidate.protocol === 'file:'
    && candidate.protocol === productionFile.protocol
    && candidate.host === productionFile.host
    && candidate.pathname === productionFile.pathname
    && !candidate.search,
  );
}

export function allowedWindowOpenKind(input: {
  url: string;
  frameName: string;
}): 'print' | 'attachment-preview' | null {
  if (input.frameName === MAIL_PRINT_FRAME_NAME && input.url === 'about:blank') {
    return 'print';
  }
  const parsed = parseUrl(input.url);
  if (
    input.frameName === MAIL_ATTACHMENT_PREVIEW_FRAME_NAME
    && parsed?.protocol === 'blob:'
  ) {
    return 'attachment-preview';
  }
  return null;
}

function parseUrl(value: string | undefined): URL | null {
  if (!value?.trim()) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
