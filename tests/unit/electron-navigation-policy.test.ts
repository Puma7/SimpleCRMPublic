import {
  MAIL_ATTACHMENT_PREVIEW_FRAME_NAME,
  MAIL_PRINT_FRAME_NAME,
  allowedWindowOpenKind,
  isAllowedRendererNavigation,
} from '../../electron/security/navigation-policy';

describe('Electron renderer navigation policy', () => {
  test('allows only the configured Vite origin in development', () => {
    const policy = {
      isDevelopment: true,
      devServerUrl: 'http://127.0.0.1:5173/app',
    };

    expect(isAllowedRendererNavigation('http://127.0.0.1:5173/#/mail', policy)).toBe(true);
    expect(isAllowedRendererNavigation('http://localhost:5173/#/mail', policy)).toBe(false);
    expect(isAllowedRendererNavigation('https://attacker.example/#/mail', policy)).toBe(false);
    expect(isAllowedRendererNavigation('javascript:alert(1)', policy)).toBe(false);
  });

  test('allows only app protocol and exact file fallback in production', () => {
    const policy = {
      isDevelopment: false,
      productionFileUrl: 'file:///C:/SimpleCRM/dist/index.html',
    };

    expect(isAllowedRendererNavigation('app://-/#/mail', policy)).toBe(true);
    expect(isAllowedRendererNavigation('file:///C:/SimpleCRM/dist/index.html#/mail', policy)).toBe(true);
    expect(isAllowedRendererNavigation('file:///C:/SimpleCRM/dist/other.html', policy)).toBe(false);
    expect(isAllowedRendererNavigation('app://attacker/#/mail', policy)).toBe(false);
    expect(isAllowedRendererNavigation('https://example.com', policy)).toBe(false);
  });

  test('allows only named print and passive attachment preview windows', () => {
    expect(allowedWindowOpenKind({
      url: 'about:blank',
      frameName: MAIL_PRINT_FRAME_NAME,
    })).toBe('print');
    expect(allowedWindowOpenKind({
      url: 'blob:app://-/a1b2c3',
      frameName: MAIL_ATTACHMENT_PREVIEW_FRAME_NAME,
    })).toBe('attachment-preview');
    expect(allowedWindowOpenKind({ url: 'about:blank', frameName: '_blank' })).toBeNull();
    expect(allowedWindowOpenKind({
      url: 'https://attacker.example',
      frameName: MAIL_ATTACHMENT_PREVIEW_FRAME_NAME,
    })).toBeNull();
  });
});
