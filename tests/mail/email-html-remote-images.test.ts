import {
  blockRemoteImagesInHtml,
  htmlHasRemoteResources,
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

  test('blocks remote url in inline style', () => {
    const html =
      '<div style="background-image: url(https://track.example/bg.png)">x</div>';
    const out = blockRemoteImagesInHtml(html);
    expect(out).not.toContain('https://track.example');
    expect(out).toContain('about:blank');
  });

  test('htmlHasRemoteResources detects http and cid', () => {
    expect(htmlHasRemoteResources('<img src="https://x.com/a">')).toBe(true);
    expect(htmlHasRemoteResources('<img src="cid:a@b">')).toBe(true);
    expect(htmlHasRemoteResources('<p>plain</p>')).toBe(false);
  });
});
