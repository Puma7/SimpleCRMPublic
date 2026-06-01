/**
 * Block remote resources in HTML mail bodies (http/https, protocol-relative, CSS urls).
 * cid: is replaced with a local placeholder (no automatic MIME resolve).
 */

const IMG_TAG_START = /<img\b/gi;
const SOURCE_TAG_START = /<source\b/gi;
const VIDEO_TAG_START = /<video\b/gi;
const AUDIO_TAG_START = /<audio\b/gi;
const TRACK_TAG_START = /<track\b/gi;
const LINK_TAG_START = /<link\b/gi;

/** http(s) or protocol-relative // */
const REMOTE_URL = /(?:https?:)?\/\//i;

const PLACEHOLDER_SVG =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="48"><rect width="100%" height="100%" fill="#e5e7eb"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="10" fill="#6b7280">Bild blockiert</text></svg>',
  );

const CID_PLACEHOLDER_SVG =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="48"><rect width="100%" height="100%" fill="#e5e7eb"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="9" fill="#6b7280">Inline-Bild</text></svg>',
  );

export type RemoteContentPolicy =
  | 'blocked'
  | 'allowed_once'
  | 'allowed_sender'
  | 'allowed_domain';

/** True if href/src value loads content from the network (not cid:, data:, about:, #). */
export function isRemoteUrl(href: string): boolean {
  const s = href.trim().toLowerCase();
  if (!s || s.startsWith('#') || s.startsWith('about:') || s.startsWith('data:')) return false;
  if (s.startsWith('cid:')) return false;
  if (s.startsWith('http://') || s.startsWith('https://')) return true;
  if (s.startsWith('//')) return true;
  return false;
}

function srcLooksRemote(src: string): boolean {
  return isRemoteUrl(src);
}

function srcLooksCid(src: string): boolean {
  return src.trim().toLowerCase().startsWith('cid:');
}

function sanitizeRemoteUrlInValue(value: string, useCidPlaceholder: boolean): string {
  if (!REMOTE_URL.test(value)) return value;
  const placeholder = useCidPlaceholder ? CID_PLACEHOLDER_SVG : PLACEHOLDER_SVG;
  return value
    .replace(/https?:\/\/[^\s"'>,]+/gi, placeholder)
    .replace(/\/\/[^\s"'>,]+/gi, placeholder);
}

function replaceQuotedAttr(tag: string, attrName: string, replaceValue: (raw: string) => string): string {
  const lower = tag.toLowerCase();
  const attr = attrName.toLowerCase();
  for (const opener of [`${attr}="`, `${attr}='`]) {
    const idx = lower.indexOf(opener);
    if (idx < 0) continue;
    const quote = opener.endsWith('"') ? '"' : "'";
    const valueStart = idx + opener.length;
    const valueEnd = tag.indexOf(quote, valueStart);
    if (valueEnd < 0) continue;
    const raw = tag.slice(valueStart, valueEnd);
    const next = replaceValue(raw);
    if (next === raw) return tag;
    return `${tag.slice(0, valueStart)}${next}${tag.slice(valueEnd)}`;
  }
  return tag;
}

function replaceRemoteSrcInMediaTag(tag: string): string {
  let out = replaceQuotedAttr(tag, 'src', (src) => {
    if (srcLooksCid(src)) return CID_PLACEHOLDER_SVG;
    if (!srcLooksRemote(src)) return src;
    return PLACEHOLDER_SVG;
  });
  out = replaceQuotedAttr(out, 'srcset', (srcset) => sanitizeRemoteUrlInValue(srcset, false));
  out = replaceQuotedAttr(out, 'poster', (poster) =>
    srcLooksRemote(poster) ? PLACEHOLDER_SVG : poster,
  );
  return out;
}

function replaceRemoteSrcInSourceTag(tag: string): string {
  let out = replaceQuotedAttr(tag, 'src', (src) => (srcLooksRemote(src) ? PLACEHOLDER_SVG : src));
  out = replaceQuotedAttr(out, 'srcset', (srcset) => sanitizeRemoteUrlInValue(srcset, false));
  return out;
}

function replaceRemoteLinkTag(tag: string): string {
  return replaceQuotedAttr(tag, 'href', (href) => {
    if (!srcLooksRemote(href)) return href;
    return 'about:blank';
  });
}

function blockRemoteInStyleBlock(styleBody: string): string {
  return styleBody
    .replace(/@import\s+url\s*\(\s*['"]?(?:https?:)?\/\/[^)'"]+['"]?\s*\)/gi, '')
    .replace(/url\s*\(\s*['"]?(?:https?:)?\/\/[^)'"]+['"]?\s*\)/gi, 'url(about:blank)');
}

function blockRemoteInStyleTags(html: string): string {
  return html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_full, inner: string) =>
    _full.replace(inner, blockRemoteInStyleBlock(inner)),
  );
}

function rewriteTagsMatching(
  html: string,
  tagRe: RegExp,
  transform: (tag: string) => string,
): string {
  if (!tagRe.test(html)) return html;
  tagRe.lastIndex = 0;
  let rebuilt = '';
  let last = 0;
  let m: RegExpExecArray | null;
  tagRe.lastIndex = 0;
  while ((m = tagRe.exec(html)) !== null) {
    const start = m.index;
    const tagEnd = html.indexOf('>', start);
    if (tagEnd < 0) break;
    const tag = html.slice(start, tagEnd + 1);
    rebuilt += html.slice(last, start) + transform(tag);
    last = tagEnd + 1;
  }
  return rebuilt + html.slice(last);
}

/** Strip http(s) and // url(...) from inline style attributes. */
function blockRemoteUrlsInStyleAttributes(html: string): string {
  return html.replace(
    /\bstyle\s*=\s*(["'])([\s\S]*?)\1/gi,
    (_full, quote: string, styleBody: string) => {
      const cleaned = blockRemoteInStyleBlock(styleBody);
      return `style=${quote}${cleaned}${quote}`;
    },
  );
}

/** Replace remote resources with placeholders (privacy). */
export function blockRemoteImagesInHtml(html: string): string {
  if (!html) return html;
  let out = rewriteTagsMatching(html, IMG_TAG_START, replaceRemoteSrcInMediaTag);
  out = rewriteTagsMatching(out, SOURCE_TAG_START, replaceRemoteSrcInSourceTag);
  out = rewriteTagsMatching(out, VIDEO_TAG_START, replaceRemoteSrcInMediaTag);
  out = rewriteTagsMatching(out, AUDIO_TAG_START, replaceRemoteSrcInMediaTag);
  out = rewriteTagsMatching(out, TRACK_TAG_START, replaceRemoteSrcInSourceTag);
  out = rewriteTagsMatching(out, LINK_TAG_START, replaceRemoteLinkTag);
  out = blockRemoteInStyleTags(out);
  return blockRemoteUrlsInStyleAttributes(out);
}

/** True if HTML likely loads remote resources without user consent. */
export function htmlHasRemoteResources(html: string): boolean {
  if (!html) return false;
  if (/(?:https?:)?\/\//i.test(html) && !/^\s*data:/i.test(html)) {
    if (/https?:\/\//i.test(html) || /(?:^|[\s"'=(])\/\/[a-z0-9]/i.test(html)) return true;
  }
  return /\bcid:/i.test(html);
}

/** Sanitize compose/outbound HTML: DOMPurify output + block remote loads. */
export function sanitizeMailHtmlBlockRemote(html: string): string {
  return blockRemoteImagesInHtml(html);
}
