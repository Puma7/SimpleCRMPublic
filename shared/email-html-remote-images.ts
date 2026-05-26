/**
 * Block remote resources in HTML mail bodies (http/https images, CSS urls).
 * cid: is replaced with a local placeholder (no automatic MIME resolve).
 */

const IMG_TAG_START = /<img\b/gi;
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

function replaceRemoteSrcInImgTag(tag: string): string {
  const lower = tag.toLowerCase();
  for (const attr of ['src="', "src='"]) {
    const idx = lower.indexOf(attr);
    if (idx < 0) continue;
    const quote = attr.endsWith('"') ? '"' : "'";
    const valueStart = idx + attr.length;
    const valueEnd = tag.indexOf(quote, valueStart);
    if (valueEnd < 0) continue;
    const src = tag.slice(valueStart, valueEnd);
    if (srcLooksCid(src)) {
      return `${tag.slice(0, valueStart)}${CID_PLACEHOLDER_SVG}${tag.slice(valueEnd)}`;
    }
    if (!srcLooksRemote(src)) return tag;
    return `${tag.slice(0, valueStart)}${PLACEHOLDER_SVG}${tag.slice(valueEnd)}`;
  }
  return tag;
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
  let out = html;
  if (IMG_TAG_START.test(out)) {
    IMG_TAG_START.lastIndex = 0;
    let rebuilt = '';
    let last = 0;
    let m: RegExpExecArray | null;
    IMG_TAG_START.lastIndex = 0;
    while ((m = IMG_TAG_START.exec(out)) !== null) {
      const start = m.index;
      const tagEnd = out.indexOf('>', start);
      if (tagEnd < 0) break;
      const tag = out.slice(start, tagEnd + 1);
      rebuilt += out.slice(last, start) + replaceRemoteSrcInImgTag(tag);
      last = tagEnd + 1;
    }
    out = rebuilt + out.slice(last);
  }
  return blockRemoteUrlsInStyleAttributes(out);
}

/** True if HTML likely loads remote resources without user consent. */
export function htmlHasRemoteResources(html: string): boolean {
  if (!html) return false;
  if (REMOTE_URL.test(html)) return true;
  return /\bcid:/i.test(html);
}
