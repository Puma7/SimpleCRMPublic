export type LoginPenalty =
  | { kind: 'none' }
  | { kind: 'temporary'; lockSeconds: number }
  | { kind: 'permanent' };

export const LOGIN_BACKOFF_SECONDS = [30, 300, 3600, 86400] as const;
export const LOGIN_PERMANENT_LOCK_AFTER_FAILURES = 50;

export function calculateLoginPenalty(failedAttempts: number): LoginPenalty {
  if (!Number.isInteger(failedAttempts) || failedAttempts < 0) {
    throw new Error('failedAttempts must be a non-negative integer');
  }

  if (failedAttempts === 0) {
    return { kind: 'none' };
  }

  if (failedAttempts >= LOGIN_PERMANENT_LOCK_AFTER_FAILURES) {
    return { kind: 'permanent' };
  }

  const index = Math.min(failedAttempts - 1, LOGIN_BACKOFF_SECONDS.length - 1);
  return { kind: 'temporary', lockSeconds: LOGIN_BACKOFF_SECONDS[index] };
}

export function shouldResetFailureCounterAfterSuccess(): true {
  return true;
}

/**
 * Kontoweite Abwehr — die Luecke, die (E-Mail, IP) offen laesst.
 *
 * Die Staffelung oben zaehlt je Paar aus Adresse und Konto. Wer aus vielen
 * Adressen kommt, faengt jedes Mal bei null an; die dauerhafte Sperre nach 50
 * Versuchen kann so nie greifen. Genau danach sieht Credential Stuffing aus.
 *
 * Warum daraus KEINE kontoweite Sperre wird: eine solche Sperre koennte jeder
 * ausloesen, der eine E-Mail-Adresse kennt — man wuerde die Anmeldung fuer
 * fremde Konten nach Belieben abschalten. Die Abwehr muss den Angreifer
 * ausbremsen, ohne den rechtmaessigen Nutzer auszusperren, und genau das leistet
 * ein CAPTCHA: der Angreifer muss fuer jeden Rateversuch bezahlen, der Nutzer
 * klickt einmal und kommt durch.
 */
export const ACCOUNT_WIDE_FAILURE_WINDOW_SECONDS = 15 * 60;
export const ACCOUNT_WIDE_CAPTCHA_AFTER_FAILURES = 10;
export const ACCOUNT_WIDE_THROTTLE_AFTER_FAILURES = 50;

export type AccountWideLoginDefense = 'none' | 'captcha' | 'throttle';

/**
 * `captchaAvailable` heisst: ein Anbieter ist eingerichtet — nicht, dass der
 * Workspace das CAPTCHA eingeschaltet hat. Die Eskalation blendet es bei Bedarf
 * zusaetzlich ein.
 *
 * Ohne Anbieter bleibt nur Bremsen, und Bremsen sperrt aus. Deshalb liegt die
 * Schwelle dort deutlich hoeher und das Fenster laeuft ab: eine Installation
 * ohne CAPTCHA soll nicht per fremder E-Mail-Adresse lahmzulegen sein. Der
 * saubere Weg ist der Anbieter — daher der Hinweis in LOGIN_SECURITY.md.
 */
export function accountWideLoginDefense(
  recentFailures: number,
  captchaAvailable: boolean,
): AccountWideLoginDefense {
  if (!Number.isFinite(recentFailures) || recentFailures < 0) return 'none';
  if (captchaAvailable) {
    return recentFailures >= ACCOUNT_WIDE_CAPTCHA_AFTER_FAILURES ? 'captcha' : 'none';
  }
  return recentFailures >= ACCOUNT_WIDE_THROTTLE_AFTER_FAILURES ? 'throttle' : 'none';
}
