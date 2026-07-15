import { buildRendererContentSecurityPolicy } from '../../electron/security/content-security-policy';

describe('renderer content security policy', () => {
  test('restricts production connections to the configured API origin', () => {
    const policy = buildRendererContentSecurityPolicy({
      isDevelopment: false,
      serverBaseUrl: 'https://crm.example.com/api',
    });

    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain('https://challenges.cloudflare.com');
    expect(policy).toContain('connect-src');
    expect(policy).toContain('https://crm.example.com');
    expect(policy).toContain('wss://crm.example.com');
    expect(policy).not.toMatch(/connect-src[^;]*\shttps:\s/);
    expect(policy).not.toContain("'unsafe-eval'");
  });

  test('allows server selection and Vite HMR only in their explicit setup modes', () => {
    const setupPolicy = buildRendererContentSecurityPolicy({
      isDevelopment: false,
      allowUnconfiguredServer: true,
    });
    expect(setupPolicy).toMatch(/connect-src[^;]*\shttps:\s/);
    expect(setupPolicy).toMatch(/connect-src[^;]*\shttp:\s/);

    const developmentPolicy = buildRendererContentSecurityPolicy({
      isDevelopment: true,
      devServerUrl: 'http://localhost:5173',
    });
    expect(developmentPolicy).toContain('http://localhost:5173');
    expect(developmentPolicy).toContain('ws://localhost:5173');
    expect(developmentPolicy).toContain("'unsafe-eval'");
  });
});
