import { openExternalUrlInBrowser } from '@/components/email/external-link-open';

describe('openExternalUrlInBrowser', () => {
  test('opens external URLs through a temporary noopener noreferrer anchor', () => {
    const clicked: HTMLAnchorElement[] = [];
    const clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function click(this: HTMLAnchorElement) {
        clicked.push(this);
      });

    try {
      openExternalUrlInBrowser('https://example.com/path?q=1#frag');
    } finally {
      clickSpy.mockRestore();
    }

    expect(clicked).toHaveLength(1);
    expect(clicked[0].href).toBe('https://example.com/path?q=1#frag');
    expect(clicked[0].target).toBe('_blank');
    expect(clicked[0].rel).toBe('noopener noreferrer');
    expect(document.body.contains(clicked[0])).toBe(false);
  });
});
