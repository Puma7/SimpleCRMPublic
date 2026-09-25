export const MAX_MSSQL_QUERY_CHARS = 8_000;

const READ_ONLY_ERROR = 'Nur lesende SELECT-Abfragen sind erlaubt';

// T-SQL runs a whole batch and needs no ';' between statements, so every verb
// that writes, changes the session/server, loops or reaches outside the database
// is refused wherever it appears (INTO covers SELECT … INTO). Checked on the
// query with comments, strings and quoted identifiers blanked out.
const FORBIDDEN_KEYWORDS = new RegExp(
  `\\b(?:${[
    'INTO', 'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'DROP', 'ALTER', 'CREATE', 'TRUNCATE',
    'EXEC', 'EXECUTE', 'GRANT', 'REVOKE', 'DENY', 'BACKUP', 'RESTORE', 'CHECKPOINT',
    'DISABLE', 'ENABLE', 'SHUTDOWN', 'KILL', 'DBCC', 'RECONFIGURE', 'WAITFOR', 'USE', 'SET',
    'DECLARE', 'OPENROWSET', 'OPENDATASOURCE', 'OPENQUERY', 'BULK',
    'ADD', 'BEGIN', 'WHILE', 'GOTO', 'WRITETEXT', 'UPDATETEXT', 'SETUSER', 'RECEIVE', 'CONVERSATION',
  ].join('|')})\\b`,
  'i',
);

export type ReadOnlyMssqlQueryValidation = { ok: true; query: string } | { ok: false; error: string };

/**
 * Accepts a single read-only SELECT (or WITH … SELECT) and returns the text to
 * run: the query with its comments removed, so the server executes exactly the
 * tokens that were checked here.
 */
export function validateReadOnlyMssqlQuery(query: unknown): ReadOnlyMssqlQueryValidation {
  const text = String(query ?? '').trim();
  if (!text) return { ok: false, error: 'SQL darf nicht leer sein' };
  if (text.length > MAX_MSSQL_QUERY_CHARS) {
    return { ok: false, error: `SQL zu lang (max ${MAX_MSSQL_QUERY_CHARS} Zeichen)` };
  }

  const lexed = lexMssqlQuery(text);
  if (!lexed) {
    return { ok: false, error: 'SQL enthält einen nicht abgeschlossenen Kommentar, Text oder Bezeichner' };
  }
  const code = lexed.code.trim();
  if (!/^(?:SELECT|WITH)\b/i.test(code)) {
    return { ok: false, error: 'Query muss mit SELECT oder WITH beginnen' };
  }
  // At most one ';', and only at the very end.
  if (FORBIDDEN_KEYWORDS.test(code) || /;(?!\s*$)/.test(code)) {
    return { ok: false, error: READ_ONLY_ERROR };
  }
  return { ok: true, query: lexed.executable.trim() };
}

/**
 * Splits T-SQL into what the checks look at (`code`: comments and quoted
 * strings/identifiers blanked) and what is executed (`executable`: comments
 * removed, literals kept). Block comments nest as in T-SQL. Returns null for an
 * unterminated comment, string or identifier.
 */
function lexMssqlQuery(text: string): { code: string; executable: string } | null {
  let code = '';
  let executable = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '-' && next === '-') {
      const newline = text.indexOf('\n', i);
      i = newline === -1 ? text.length : newline;
      code += ' ';
      executable += ' ';
      continue;
    }
    if (ch === '/' && next === '*') {
      let depth = 1;
      let j = i + 2;
      while (j < text.length && depth > 0) {
        if (text[j] === '/' && text[j + 1] === '*') {
          depth += 1;
          j += 2;
        } else if (text[j] === '*' && text[j + 1] === '/') {
          depth -= 1;
          j += 2;
        } else {
          j += 1;
        }
      }
      if (depth > 0) return null;
      i = j;
      code += ' ';
      executable += ' ';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '[') {
      const close = ch === '[' ? ']' : ch;
      let j = i + 1;
      for (;;) {
        if (j >= text.length) return null;
        if (text[j] === close) {
          if (text[j + 1] !== close) break;
          j += 2; // doubled delimiter = escaped
        } else {
          j += 1;
        }
      }
      executable += text.slice(i, j + 1);
      // Spaces keep neighbouring words apart: SELECT'x'INTO must still show INTO.
      code += ' 0 ';
      i = j + 1;
      continue;
    }
    code += ch;
    executable += ch;
    i += 1;
  }
  return { code, executable };
}
