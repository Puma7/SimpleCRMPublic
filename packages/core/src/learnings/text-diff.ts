/**
 * Wort-Diff für die Änderungsansicht der Learnings (TA-P5). Eigene
 * Myers-Implementierung ohne Abhängigkeit: zuerst zeilenweise, dann innerhalb
 * geänderter Zeilenblöcke wortweise. Gemeinsamer Anfang/gemeinsames Ende
 * werden vorab abgeschnitten, damit kleine Änderungen an großen Dokumenten
 * (100 000 Zeichen) schnell bleiben.
 */

export type TextDiffSegmentType = 'equal' | 'insert' | 'delete';

export type TextDiffSegment = {
  type: TextDiffSegmentType;
  text: string;
};

export type TextDiffOptions = {
  /** Obergrenze für die Editierdistanz je Myers-Lauf; darüber: Block ersetzen. */
  maxEditDistance?: number;
};

type Op = { type: TextDiffSegmentType; a: number; b: number; count: number };

const DEFAULT_MAX_EDIT_DISTANCE = 2000;
/** Wortweise nur für Blöcke bis zu dieser Tokenzahl (sonst zeilenweise lassen). */
const MAX_WORD_DIFF_TOKENS = 20000;

/**
 * Myers O((N+M)·D) mit gespeicherten V-Ausschnitten je D (Speicher O(D²)).
 * Liefert null, wenn die Distanz maxD übersteigt.
 */
function myers(a: readonly string[], b: readonly string[], maxD: number): Op[] | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, maxD);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max; d += 1) {
    const snapshot = new Int32Array(2 * d + 1);
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)) {
        x = v[offset + k + 1]!;
      } else {
        x = v[offset + k - 1]! + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
    for (let k = -d; k <= d; k += 1) snapshot[k + d] = v[offset + k]!;
    trace.push(snapshot);
    if (found >= 0) break;
  }
  if (found < 0) return null;

  // Rückwärts durch die gespeicherten Ausschnitte.
  const ops: Op[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d -= 1) {
    const prev = trace[d - 1]!;
    const k = x - y;
    const getPrev = (kk: number) => (kk < -(d - 1) || kk > d - 1 ? -1 : prev[kk + d - 1]!);
    let prevK: number;
    if (k === -d || (k !== d && getPrev(k - 1) < getPrev(k + 1))) prevK = k + 1;
    else prevK = k - 1;
    const prevX = getPrev(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x -= 1;
      y -= 1;
      ops.push({ type: 'equal', a: x, b: y, count: 1 });
    }
    if (x === prevX) {
      y -= 1;
      ops.push({ type: 'insert', a: x, b: y, count: 1 });
    } else {
      x -= 1;
      ops.push({ type: 'delete', a: x, b: y, count: 1 });
    }
  }
  while (x > 0 && y > 0) {
    x -= 1;
    y -= 1;
    ops.push({ type: 'equal', a: x, b: y, count: 1 });
  }
  ops.reverse();
  return ops;
}

function pushSegment(out: TextDiffSegment[], type: TextDiffSegmentType, text: string): void {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.type === type) last.text += text;
  else out.push({ type, text });
}

function splitLines(text: string): string[] {
  // Zeilen inklusive Umbruch, damit das Zusammensetzen verlustfrei ist.
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) {
      out.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
}

const WORD_TOKEN = /[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu;

function tokenizeWords(text: string): string[] {
  return text.match(WORD_TOKEN) ?? [];
}

function diffTokens(
  a: readonly string[],
  b: readonly string[],
  maxD: number,
  out: TextDiffSegment[],
): boolean {
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < a.length - prefix
    && suffix < b.length - prefix
    && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) suffix += 1;
  const aMid = a.slice(prefix, a.length - suffix);
  const bMid = b.slice(prefix, b.length - suffix);
  const ops = aMid.length === 0 || bMid.length === 0 ? [] : myers(aMid, bMid, maxD);
  if (ops === null) return false;
  pushSegment(out, 'equal', a.slice(0, prefix).join(''));
  if (aMid.length === 0) pushSegment(out, 'insert', bMid.join(''));
  else if (bMid.length === 0) pushSegment(out, 'delete', aMid.join(''));
  else {
    for (const op of ops) {
      pushSegment(out, op.type, op.type === 'insert' ? bMid[op.b]! : aMid[op.a]!);
    }
  }
  pushSegment(out, 'equal', a.slice(a.length - suffix).join(''));
  return true;
}

function diffChangedBlock(oldBlock: string, newBlock: string, maxD: number, out: TextDiffSegment[]): void {
  if (!oldBlock) return pushSegment(out, 'insert', newBlock);
  if (!newBlock) return pushSegment(out, 'delete', oldBlock);
  const a = tokenizeWords(oldBlock);
  const b = tokenizeWords(newBlock);
  if (a.length + b.length <= MAX_WORD_DIFF_TOKENS) {
    const local: TextDiffSegment[] = [];
    if (diffTokens(a, b, maxD, local)) {
      for (const segment of local) pushSegment(out, segment.type, segment.text);
      return;
    }
  }
  pushSegment(out, 'delete', oldBlock);
  pushSegment(out, 'insert', newBlock);
}

/**
 * Unterschiede zwischen zwei Texten als Segmente. Die Konkatenation aller
 * equal+delete-Segmente ergibt `oldText`, aller equal+insert-Segmente `newText`.
 */
export function diffText(oldText: string, newText: string, options: TextDiffOptions = {}): TextDiffSegment[] {
  const before = String(oldText ?? '');
  const after = String(newText ?? '');
  const maxD = Math.max(1, options.maxEditDistance ?? DEFAULT_MAX_EDIT_DISTANCE);
  const out: TextDiffSegment[] = [];
  if (before === after) {
    pushSegment(out, 'equal', before);
    return out;
  }
  const a = splitLines(before);
  const b = splitLines(after);

  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < a.length - prefix
    && suffix < b.length - prefix
    && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) suffix += 1;
  pushSegment(out, 'equal', a.slice(0, prefix).join(''));

  const aMid = a.slice(prefix, a.length - suffix);
  const bMid = b.slice(prefix, b.length - suffix);
  const lineOps = aMid.length === 0 || bMid.length === 0 ? null : myers(aMid, bMid, maxD);

  if (lineOps === null) {
    diffChangedBlock(aMid.join(''), bMid.join(''), maxD, out);
  } else {
    // Aufeinanderfolgende delete/insert-Zeilen als Block wortweise vergleichen.
    let pendingDelete = '';
    let pendingInsert = '';
    const flush = () => {
      if (pendingDelete || pendingInsert) diffChangedBlock(pendingDelete, pendingInsert, maxD, out);
      pendingDelete = '';
      pendingInsert = '';
    };
    for (const op of lineOps) {
      if (op.type === 'equal') {
        flush();
        pushSegment(out, 'equal', aMid[op.a]!);
      } else if (op.type === 'delete') {
        pendingDelete += aMid[op.a]!;
      } else {
        pendingInsert += bMid[op.b]!;
      }
    }
    flush();
  }
  pushSegment(out, 'equal', a.slice(a.length - suffix).join(''));
  return out;
}

/** Kennzahlen für die Anzeige („+12 / −3 Wörter“). */
export function summarizeTextDiff(segments: readonly TextDiffSegment[]): { inserted: number; deleted: number } {
  let inserted = 0;
  let deleted = 0;
  for (const segment of segments) {
    if (segment.type === 'equal') continue;
    const words = (segment.text.match(/[\p{L}\p{N}_]+/gu) ?? []).length;
    if (segment.type === 'insert') inserted += words;
    else deleted += words;
  }
  return { inserted, deleted };
}
