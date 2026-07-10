import { render } from '@testing-library/react';

import { EmailHtmlFrame } from '../../src/components/email/email-html-frame';

describe('EmailHtmlFrame', () => {
  test('renders the body inside an iframe, not as live DOM in the parent tree', () => {
    const html = '<p id="body-marker">Hallo Welt</p><script>window.__pwned=1</script>';
    const { container } = render(<EmailHtmlFrame html={html} allowRemote={false} />);

    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();

    // The body must NOT be injected into the parent document.
    expect(container.querySelector('#body-marker')).toBeNull();
    expect(container.querySelector('script')).toBeNull();

    // It must live inside the iframe's srcdoc string instead.
    const srcdoc = iframe!.getAttribute('srcdoc') ?? '';
    expect(srcdoc).toContain('id="body-marker"');
  });

  test('sandbox grants neither scripts nor same-origin', () => {
    const { container } = render(<EmailHtmlFrame html="<p>x</p>" allowRemote={false} />);
    const iframe = container.querySelector('iframe')!;

    expect(iframe.hasAttribute('sandbox')).toBe(true);
    const sandbox = iframe.getAttribute('sandbox') ?? '';
    expect(sandbox).not.toContain('allow-scripts');
    expect(sandbox).not.toContain('allow-same-origin');
  });

  test('embeds a restrictive CSP and blocks remote images by default', () => {
    const { container } = render(<EmailHtmlFrame html="<p>x</p>" allowRemote={false} />);
    const srcdoc = container.querySelector('iframe')!.getAttribute('srcdoc') ?? '';

    expect(srcdoc).toContain('Content-Security-Policy');
    expect(srcdoc).toContain("default-src 'none'");
    expect(srcdoc).toContain('img-src data:');
    // Remote schemes are not permitted when the user has not opted in.
    expect(srcdoc).not.toContain('https:');
  });

  test('permits remote image loads once the user opts in', () => {
    const { container } = render(<EmailHtmlFrame html="<p>x</p>" allowRemote />);
    const srcdoc = container.querySelector('iframe')!.getAttribute('srcdoc') ?? '';

    expect(srcdoc).toContain('img-src data: https:');
  });
});
