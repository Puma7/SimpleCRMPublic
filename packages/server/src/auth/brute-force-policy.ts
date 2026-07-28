export type LoginPenalty =
  | { kind: 'none' }
  | { kind: 'temporary'; lockSeconds: number }
  | { kind: 'permanent' };

export const LOGIN_BACKOFF_SECONDS = [30, 300, 3600, 86400] as const;

/**
 * Es gibt keine dauerhafte Sperre mehr — sie versprach Schutz, den sie nie
 * geliefert hat.
 *
 * Frueher: `permanent` ab 50 Fehlversuchen je (E-Mail, IP). Der Zaehler steigt
 * aber gestaffelt, ab dem vierten Versuch mit 24 Stunden Wartezeit dazwischen —
 * von einer Adresse aus dauerte der 50. Versuch damit rund 46 Tage. Ein
 * Angreifer erreichte die Schwelle also nie, und wer sie doch erreichte, war
 * eher ein Anschluss hinter geteiltem NAT, der dann dauerhaft ausgesperrt war,
 * ohne dass es dafuer einen Weg zurueck gab.
 *
 * Was tatsaechlich schuetzt, steht woanders: die Staffelung bis 24 Stunden je
 * Adresse gegen hartnaeckiges Raten, und die kontoweite CAPTCHA-Pflicht unten
 * gegen verteiltes. Beides greift, beides sperrt niemanden dauerhaft aus.
 *
 * Bereits gesetzte `permanent`-Zeilen werden weiterhin geachtet
 * (postgres-auth-port.checkLoginLock) — bestehende Sperren verschwinden nicht
 * still, es entstehen nur keine neuen mehr.
 */
export function calculateLoginPenalty(failedAttempts: number): LoginPenalty {
  if (!Number.isInteger(failedAttempts) || failedAttempts < 0) {
    throw new Error('failedAttempts must be a non-negative integer');
  }

  if (failedAttempts === 0) {
    return { kind: 'none' };
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
/**
 * Gemessen wird BREITE, nicht Tiefe: von wie vielen verschiedenen Adressen kam
 * im Fenster ein Fehlversuch gegen dieses Konto. Tiefe je Adresse faengt die
 * Staffelung oben ab (ab dem vierten Versuch 24 Stunden Sperre fuer das Paar).
 *
 * Und nur Breite ist mit auth_login_failures ueberhaupt ehrlich messbar: die
 * Tabelle fuehrt je Paar eine Zeile mit kumuliertem Zaehler, failed_at ist der
 * letzte Versuch. "Wie viele Versuche in den letzten 15 Minuten" laesst sich
 * daraus nicht ableiten — "von wie vielen Adressen kam gerade etwas" schon.
 *
 * Sechs Adressen: ein Mensch scheitert nicht binnen einer Viertelstunde von
 * sechs verschiedenen Anschluessen aus, ein Botnet tut genau das. Die Folge ist
 * ohnehin nur eine Huerde, keine Sperre.
 */
export const ACCOUNT_WIDE_FAILURE_WINDOW_SECONDS = 15 * 60;
export const ACCOUNT_WIDE_CAPTCHA_AFTER_SOURCES = 6;
export const ACCOUNT_WIDE_THROTTLE_AFTER_SOURCES = 20;

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
  recentSources: number,
  captchaAvailable: boolean,
): AccountWideLoginDefense {
  if (!Number.isFinite(recentSources) || recentSources < 0) return 'none';
  if (captchaAvailable) {
    return recentSources >= ACCOUNT_WIDE_CAPTCHA_AFTER_SOURCES ? 'captcha' : 'none';
  }
  return recentSources >= ACCOUNT_WIDE_THROTTLE_AFTER_SOURCES ? 'throttle' : 'none';
}
