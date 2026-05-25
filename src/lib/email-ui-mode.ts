import { readUiTheme, writeUiTheme, type UiTheme } from "./ui-theme"

/** @deprecated Prefer `UiTheme` from `@/lib/ui-theme` — same storage key. */
export type EmailUiMode = UiTheme

export const readEmailUiMode = readUiTheme
export const writeEmailUiMode = writeUiTheme
