/**
 * Same result as `/^[A-Za-z0-9+/]+={0,2}$/.test(value)`, as a plain loop.
 * Base64 payloads reach tens of megabytes (compose and PGP attachments); on
 * such inputs the regex threw "Maximum call stack size exceeded" in a process
 * running with the V8 linear-regexp fallback flag (see user-regex.ts), which
 * the API and the desktop main process always set. The length check (multiple
 * of 4) stays with the callers, as before.
 */
export function isStrictBase64Payload(value: string): boolean {
  let end = value.length;
  let padding = 0;
  while (end > 0 && padding < 2 && value.charCodeAt(end - 1) === 61 /* = */) {
    end -= 1;
    padding += 1;
  }
  if (end === 0) return false;
  for (let i = 0; i < end; i += 1) {
    const c = value.charCodeAt(i);
    const valid = (c >= 65 && c <= 90) // A-Z
      || (c >= 97 && c <= 122) // a-z
      || (c >= 48 && c <= 57) // 0-9
      || c === 43 // +
      || c === 47; // /
    if (!valid) return false;
  }
  return true;
}
