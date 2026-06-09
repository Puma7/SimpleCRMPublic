import {
  issueCaptchaChallenge,
  verifyCaptchaChallenge,
} from '../../packages/server/src/security/captcha-challenge';
import { hashLoginPin, verifyLoginPin } from '../../packages/server/src/security/login-pin-hash';
import { generateTotpSecret, verifyTotpCode } from '../../packages/server/src/security/totp';
import { authenticator } from 'otplib';

describe('login security helpers', () => {
  const signer = {
    keyId: 'test',
    secret: Buffer.from('test-secret-test-secret-test-secret!!'),
  };

  test('captcha challenge roundtrip', () => {
    const issuedAt = new Date('2026-01-01T12:00:00.000Z');
    const challenge = issueCaptchaChallenge({
      signer,
      ip: '127.0.0.1',
      issuedAt,
    });
    expect(verifyCaptchaChallenge({
      token: challenge,
      signer,
      ip: '127.0.0.1',
      now: issuedAt,
    })).toBe(true);
    expect(verifyCaptchaChallenge({
      token: challenge,
      signer,
      ip: '9.9.9.9',
      now: issuedAt,
    })).toBe(false);
  });

  test('login pin hash roundtrip', async () => {
    const hash = await hashLoginPin('123456');
    expect(await verifyLoginPin('123456', hash)).toBe(true);
    expect(await verifyLoginPin('654321', hash)).toBe(false);
  });

  test('totp secret verifies generated code', () => {
    const secret = generateTotpSecret();
    const token = authenticator.generate(secret);
    expect(verifyTotpCode(secret, token)).toBe(true);
  });
});
