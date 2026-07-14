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

export function isAllowedChildWindowNavigation(input: {
  initialUrl: string;
  candidateUrl: string;
  kind: 'print' | 'attachment-preview';
}): boolean {
  if (input.candidateUrl === input.initialUrl) return true;
  if (input.kind !== 'attachment-preview') return false;
  const initialOrigin = parseBlobSourceOrigin(input.initialUrl);
  return initialOrigin !== null && parseBlobSourceOrigin(input.candidateUrl) === initialOrigin;
}

function parseBlobSourceOrigin(value: string): string | null {
  const blobUrl = parseUrl(value);
  if (blobUrl?.protocol !== 'blob:') return null;
  const sourceUrl = parseUrl(blobUrl.pathname);
  if (!sourceUrl) return null;
  if (sourceUrl.origin !== 'null') return sourceUrl.origin;
  return sourceUrl.protocol === 'app:' && sourceUrl.hostname === '-' ? 'app://-' : null;
}

function parseUrl(value: string | undefined): URL | null {
  if (!value?.trim()) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
