import {
  blockRemoteImagesInHtml,
  htmlHasRemoteResources,
  isRemoteUrl,
  mapStyleBlockContents,
} from '../../shared/email-html-remote-images';

describe('blockRemoteImagesInHtml', () => {
  test('replaces https img src with placeholder', () => {
    const html = '<p>Hi</p><img src="https://tracker.example/pixel.gif" width="1">';
    const out = blockRemoteImagesInHtml(html);
    expect(out).not.toContain('https://tracker.example');
    expect(out).toContain('data:image/svg+xml');
  });

  test('replaces cid images with inline placeholder', () => {
    const html = '<img src="cid:inline-1@simplecrm">';
    const out = blockRemoteImagesInHtml(html);
    expect(out).not.toContain('cid:inline');
    expect(out).toContain('data:image/svg+xml');
  });

  test('leaves data urls unchanged', () => {
    const html = '<img src="data:image/png;base64,abc">';
    expect(blockRemoteImagesInHtml(html)).toBe(html);
  });

  test('blocks https srcset on img', () => {
    const html =
      '<img src="data:image/png;base64,abc" srcset="https://cdn.example/a.png 1x, https://cdn.example/b.png 2x">';
    const out = blockRemoteImagesInHtml(html);
    expect(out).not.toContain('https://cdn.example');
    expect(out).toContain('srcset=');
    expect(out).toContain('data:image/svg+xml');
  });

  test('blocks remote srcset on source inside picture', () => {
    const html =
      '<picture><source srcset="https://cdn.example/hero.webp" type="image/webp"><img src="https://x.com/f.jpg"></picture>';
    const out = blockRemoteImagesInHtml(html);
    expect(out).not.toContain('https://cdn.example');
    expect(out).not.toContain('https://x.com');
  });

  test('blocks remote url in inline style', () => {
    const html =
      '<div style="background-image: url(https://track.example/bg.png)">x</div>';
    const out = blockRemoteImagesInHtml(html);
    expect(out).not.toContain('https://track.example');
    expect(out).toContain('about:blank');
  });

  test('blocks protocol-relative img src', () => {
    const html = '<img src="//cdn.example/track.gif">';
    const out = blockRemoteImagesInHtml(html);
    expect(out).not.toContain('//cdn.example');
  });

  test('blocks remote video src', () => {
    const html = '<video src="https://v.example/m.mp4"></video>';
    const out = blockRemoteImagesInHtml(html);
    expect(out).not.toContain('https://v.example');
  });

  test('blocks remote link href', () => {
    const html = '<link rel="stylesheet" href="https://fonts.example/f.css">';
    const out = blockRemoteImagesInHtml(html);
    expect(out).not.toContain('https://fonts.example');
  });

  test('blocks remote url in style block', () => {
    const html = '<style>body { background: url(https://t.example/bg.png); }</style>';
    const out = blockRemoteImagesInHtml(html);
    expect(out).not.toContain('https://t.example');
  });

  // F-A6-06: Der bereinigte Style-Text ging als Ersetzungs-String an String.replace ('$&' holte die Remote-URL zurueck) und ersetzte nur das erste Vorkommen.
  test.each([
    ['$&', '<style>$& b{} a{background:url(https://x.test/p.png)}</style>'],
    ['$`', '<style>$` b{} a{background:url(https://x.test/p.png)}</style>'],
    ["$'", "<style>a{background:url(https://x.test/p.png)} b{} $'</style>"],
    ['title attribute', '<style title="a{background:url(https://x.test/p)}">a{background:url(https://x.test/p)}</style>'],
  ])('blocks remote url in style block with replacement pattern trick (%s)', (_case, html) => {
    const out = blockRemoteImagesInHtml(html);
    const styleBody = /<style\b[^>]*>([\s\S]*?)<\/style>/i.exec(out)?.[1] ?? '';
    expect(styleBody).toContain('url(about:blank)');
    expect(styleBody).not.toContain('https://x.test');
  });

  test('leaves a harmless style block with dollar signs byte-identical', () => {
    const html = '<style>p::after { content: "$5 $& $\'"; }</style><p>x</p>';
    expect(blockRemoteImagesInHtml(html)).toBe(html);
  });

  // F-N-redos-03: Die <style>-Regex lief bei nicht geschlossenen <style>-Tags quadratisch (140 KB wiederholtes <style> kostete 1,4 s im Renderer).
  test('stays linear for many unclosed style tags', () => {
    for (const html of [
      '<style>'.repeat(40_000),
      '<style media="x">'.repeat(15_000),
      `<style>a{background:url(https://x.test/p.png)}</style>${'<style>'.repeat(40_000)}`,
      '<style'.repeat(40_000),
    ]) {
      const started = Date.now();
      const out = blockRemoteImagesInHtml(html);
      expect(Date.now() - started).toBeLessThan(500);
      expect(out).not.toContain('https://x.test');
    }
  });

  // F-N-redos-03: Der lineare Scan muss exakt das Ergebnis der bisherigen Regex liefern.
  test('mapStyleBlockContents matches the previous style regex', () => {
    const transform = (inner: string) => `[${inner.length}:${inner.toUpperCase()}]`;
    const legacy = (html: string) => html.replace(
      /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
      (_full, open: string, inner: string, close: string) => `${open}${transform(inner)}${close}`,
    );
    const samples = [
      '',
      '<p>kein Style</p>',
      '<style>a{}</style>',
      '<STYLE type="text/css">b{}</Style><style>c{}</STYLE>',
      '<style>unverschlossen',
      '<styles>kein Treffer</style>',
      '<style-x>Grenze</style>',
      '<style x="a>b">innen</style>',
      '<style><style>doppelt</style></style>',
      '<style>$& $1 $\'</style>',
    ];
    const tokens = ['<style', '<STYLE', '<styles', '<style-', '>', '</style>', '</STYLE>', '</style >', '<', '/', ' ', 'a', 'ü', '\n', '"', '$&'];
    let seed = 0x5eed03;
    const random = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
      return seed / 0x80000000;
    };
    for (let n = 0; n < 5000; n += 1) {
      const count = Math.floor(random() * 16);
      let html = '';
      for (let i = 0; i < count; i += 1) html += tokens[Math.floor(random() * tokens.length)];
      samples.push(html);
    }
    for (const html of samples) {
      expect(mapStyleBlockContents(html, transform)).toBe(legacy(html));
    }
  });

  test('isRemoteUrl', () => {
    expect(isRemoteUrl('https://a.com')).toBe(true);
    expect(isRemoteUrl('//a.com/x')).toBe(true);
    expect(isRemoteUrl('cid:x')).toBe(false);
    expect(isRemoteUrl('data:image/png;base64,x')).toBe(false);
  });

  test('htmlHasRemoteResources detects http and cid', () => {
    expect(htmlHasRemoteResources('<img src="https://x.com/a">')).toBe(true);
    expect(htmlHasRemoteResources('<img src="cid:a@b">')).toBe(true);
    expect(htmlHasRemoteResources('<p>plain</p>')).toBe(false);
  });
});
