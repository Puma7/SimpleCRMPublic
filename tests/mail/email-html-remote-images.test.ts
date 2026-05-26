import { blockRemoteImagesInHtml } from '../../shared/email-html-remote-images';

describe('blockRemoteImagesInHtml', () => {
  test('replaces https img src with placeholder', () => {
    const html = '<p>Hi</p><img src="https://tracker.example/pixel.gif" width="1">';
    const out = blockRemoteImagesInHtml(html);
    expect(out).not.toContain('https://tracker.example');
    expect(out).toContain('data:image/svg+xml');
  });

  test('leaves cid images unchanged', () => {
    const html = '<img src="cid:inline-1@simplecrm">';
    expect(blockRemoteImagesInHtml(html)).toBe(html);
  });

  test('leaves data urls unchanged', () => {
    const html = '<img src="data:image/png;base64,abc">';
    expect(blockRemoteImagesInHtml(html)).toBe(html);
  });
});
