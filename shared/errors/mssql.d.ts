type MssqlErrorCategory = 'authentication' | 'network' | 'database' | 'permission' | 'ssl' | 'timeout' | 'configuration' | 'unknown';
type MssqlErrorSeverity = 'low' | 'medium' | 'high';
export interface ParsedError {
    title: string;
    description: string;
    originalMessage?: string;
    code?: string;
    name?: string;
    actionableAdvice?: string;
    docsUrl?: string;
    category?: MssqlErrorCategory;
    severity?: MssqlErrorSeverity;
}
/**
 * Parses a connection error and returns a user-friendly message.
 * Attempts to identify known MSSQL/Tedious error codes.
 * @param error The error object or string.
 * @param lang The preferred language ('de' or 'en'). Defaults to 'de'.
 */
export declare function getFriendlyMssqlError(error: unknown, lang?: 'de' | 'en'): ParsedError;
export type { MssqlErrorCategory, MssqlErrorSeverity };
