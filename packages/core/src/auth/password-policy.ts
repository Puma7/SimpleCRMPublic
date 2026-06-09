export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 1000;

export function isPasswordLengthValid(password: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH && password.length <= MAX_PASSWORD_LENGTH;
}

export function getPasswordTooShortMessage(): string {
  return `Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen haben`;
}

export function getPasswordTooLongMessage(): string {
  return `Passwort darf maximal ${MAX_PASSWORD_LENGTH} Zeichen haben`;
}
