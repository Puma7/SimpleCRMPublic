/**
 * Block remote image loads in HTML mail bodies (http/https).
 * cid: and data: URLs are left unchanged.
 */

const IMG_TAG_START = /<img\b/gi;

function srcLooksRemote(src: string): boolean {
  const s = src.trim().toLowerCase();
  return s.startsWith('http://') || s.startsWith('https://');
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
    if (!srcLooksRemote(src)) return tag;
    const placeholder =
      'data:image/svg+xml,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="48"><rect width="100%" height="100%" fill="#e5e7eb"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="10" fill="#6b7280">Bild blockiert</text></svg>',
      );
    return `${tag.slice(0, valueStart)}${placeholder}${tag.slice(valueEnd)}`;
  }
  return tag;
}

/** Replace http(s) img src with a local placeholder SVG (privacy). */
export function blockRemoteImagesInHtml(html: string): string {
  if (!html || !IMG_TAG_START.test(html)) return html;
  IMG_TAG_START.lastIndex = 0;
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  IMG_TAG_START.lastIndex = 0;
  while ((m = IMG_TAG_START.exec(html)) !== null) {
    const start = m.index;
    const tagEnd = html.indexOf('>', start);
    if (tagEnd < 0) break;
    const tag = html.slice(start, tagEnd + 1);
    out += html.slice(last, start) + replaceRemoteSrcInImgTag(tag);
    last = tagEnd + 1;
  }
  return out + html.slice(last);
}
