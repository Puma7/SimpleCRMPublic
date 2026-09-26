import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

test('real Quill copy/cut sanitizes exported HTML and preserves rich text and deletion', () => {
  // Native ESM loads the installed Quill, rather than the editor component mocks.
  // jsdom does not enable scripts or external resources; no OS clipboard is used.
  const script = String.raw`
    const assert = require('node:assert/strict');
    const { createRequire } = require('node:module');
    const { pathToFileURL } = require('node:url');
    const path = require('node:path');
    const repo = process.argv[1];
    const req = createRequire(path.join(repo, 'package.json'));
    const { JSDOM } = createRequire(req.resolve('jest-environment-jsdom'))('jsdom');
    const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'https://example.test' });
    for (const name of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Text', 'MutationObserver', 'DOMParser']) {
      Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? dom.window : dom.window[name] });
    }
    globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
    dom.window.Range.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 });
    dom.window.Range.prototype.getClientRects = () => [];
    req('tsx/cjs');
    const { sanitizeQuillClipboard } = req('./src/lib/quill-clipboard.ts');
    (async () => {
      const Quill = (await import(pathToFileURL(req.resolve('quill')).href)).default;
      const host = document.createElement('div');
      document.body.appendChild(host);
      const q = new Quill(host);
      sanitizeQuillClipboard(q);
      function clipboard(kind) {
        const data = new Map();
        const event = new dom.window.Event(kind, { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'clipboardData', { value: { setData: (type, value) => data.set(type, value) } });
        q.setSelection(0, q.getLength());
        q.root.dispatchEvent(event);
        assert.equal(event.defaultPrevented, true);
        return data;
      }
      const videoValue = 'https://example.invalid/"><img src=x onerror="void 0">';
      const encoded = videoValue.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
      for (const kind of ['copy', 'cut']) {
        q.clipboard.dangerouslyPasteHTML('<iframe class="ql-video" src="' + encoded + '"></iframe>');
        assert.ok(q.root.querySelector('iframe'));
        const output = clipboard(kind).get('text/html');
        const parsed = new DOMParser().parseFromString(output, 'text/html');
        assert.equal(parsed.querySelectorAll('[onerror],script,iframe').length, 0);
        if (kind === 'cut') assert.equal(q.getText().trim(), '');
      }
      for (const kind of ['copy', 'cut']) {
        q.clipboard.dangerouslyPasteHTML('<p><strong>Grüße</strong> <a href="https://example.test/path">Link</a></p>');
        const originalText = q.getText();
        const data = clipboard(kind);
        const parsed = new DOMParser().parseFromString(data.get('text/html'), 'text/html');
        assert.equal(parsed.querySelector('strong').textContent, 'Grüße');
        assert.equal(parsed.querySelector('a').getAttribute('href'), 'https://example.test/path');
        assert.equal(data.get('text/plain'), 'Grüße Link');
        assert.equal(q.getText(), kind === 'cut' ? '\n' : originalText);
      }
      dom.window.close();
      console.log('quill-copy-cut-contract-ok');
    })().catch((error) => { console.error(error); process.exitCode = 1; dom.window.close(); });
  `;
  const output = execFileSync(process.execPath, ['--eval', script, resolve(__dirname, '../..')], {
    encoding: 'utf8',
    timeout: 15_000,
    windowsHide: true,
  });
  expect(output).toContain('quill-copy-cut-contract-ok');
}, 20_000);
