/**
 * Block remote resources in HTML mail bodies (http/https images, CSS urls).
 * cid: is replaced with a local placeholder (no automatic MIME resolve).
 */

const IMG_TAG_START = /<img\b/gi;
const SOURCE_TAG_START = /<source\b/gi;
const REMOTE_URL = /https?:\/\//i;

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

function srcLooksRemote(src: string): boolean {
  const s = src.trim().toLowerCase();
  return s.startsWith('http://') || s.startsWith('https://');
}

function srcLooksCid(src: string): boolean {
  return src.trim().toLowerCase().startsWith('cid:');
}

function sanitizeRemoteUrlInValue(value: string, useCidPlaceholder: boolean): string {
  if (!REMOTE_URL.test(value)) return value;
  const placeholder = useCidPlaceholder ? CID_PLACEHOLDER_SVG : PLACEHOLDER_SVG;
  return value.replace(/https?:\/\/[^\s"'>,]+/gi, placeholder);
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

function replaceRemoteSrcInImgTag(tag: string): string {
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

/** Strip http(s) url(...) from inline style attributes (tracking pixels via CSS). */
function blockRemoteUrlsInStyleAttributes(html: string): string {
  return html.replace(
    /\bstyle\s*=\s*(["'])([\s\S]*?)\1/gi,
    (_full, quote: string, styleBody: string) => {
      const cleaned = styleBody.replace(/url\s*\(\s*['"]?https?:\/\/[^)'"]+['"]?\s*\)/gi, 'url(about:blank)');
      return `style=${quote}${cleaned}${quote}`;
    },
  );
}

/** Replace http(s) img src with a local placeholder SVG (privacy). */
export function blockRemoteImagesInHtml(html: string): string {
  if (!html) return html;
  let out = rewriteTagsMatching(html, IMG_TAG_START, replaceRemoteSrcInImgTag);
  out = rewriteTagsMatching(out, SOURCE_TAG_START, replaceRemoteSrcInSourceTag);
  return blockRemoteUrlsInStyleAttributes(out);
}

/** True if HTML likely loads remote resources without user consent. */
export function htmlHasRemoteResources(html: string): boolean {
  if (!html) return false;
  if (REMOTE_URL.test(html)) return true;
  return /\bcid:/i.test(html);
}
