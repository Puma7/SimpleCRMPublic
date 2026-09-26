// Opening goes through shell.openPath, so everything the OS would execute, mount
// or run macros from needs the explicit confirmation. The list lives in
// @simplecrm/core (packages/core/src/email/attachment-safety.ts) and is the same
// one the server uses for the mail.attachment.suspicious_download gate.
export { isPotentiallyDangerousAttachment } from '@simplecrm/core';
