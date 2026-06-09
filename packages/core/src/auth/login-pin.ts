export const LOGIN_PIN_LENGTH = 6;

const LOGIN_PIN_PATTERN = /^\d{6}$/;

export function isLoginPinFormat(value: string): boolean {
  return LOGIN_PIN_PATTERN.test(value);
}

export function assertLoginPinFormat(value: string): void {
  if (!isLoginPinFormat(value)) {
    throw new Error(`Login-PIN muss genau ${LOGIN_PIN_LENGTH} Ziffern haben`);
  }
}
