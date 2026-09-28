# Plan 039: DOC, XLS and RTF readers stop at an output budget instead of amplifying crafted files

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update this plan's row in
> `plans/README.md` (section "Runde 2") AND tick its checkbox in
> `plans/MASTERPLAN.md`.
>
> **Drift check (run first)**:
> `git diff --stat 9e0491e3..HEAD -- packages/core/src/email/attachment-office-text.ts tests/unit/attachment-office-text.test.ts`
> If either file changed, compare the excerpts below against the live code; on a mismatch, STOP.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security (DoS)
- **Planned at**: commit `9e0491e3`, 2026-09-27

The audit claim is verified, and the real effect is worse than the audit said. Measured against the built `packages/core/dist` at this commit:
- A **66 KB** crafted `.doc` (5 000 overlapping pieces) yields 15 360 000 characters. That took 3.7 s and about 750 MB RSS.
- A 6.8 MB `.xls` made of empty BIFF records costs about 410 MB RSS just to list the records.
- A 15 MB plain RTF costs about 1 GB RSS and 5 s. About 610 MB of that comes from the character-by-character `latin1()` string building, and about 460 MB from the `number[]` byte buffer.

## Why this matters

Both editions index text from mail attachments. Server and Desktop run the same readers from `packages/core`, in a worker with a 512 MB heap and a 30 s timeout. The ZIP formats have budgets, but the compound-file formats (DOC, XLS) and RTF have none. The text cap (`capAttachmentText`, 500 000 chars) is applied only *after* extraction. So a small attachment can make the worker allocate hundreds of MB and burn CPU until it hits OOM or the timeout, once per attachment, and every sync or re-extraction repeats it. After this plan the readers stop producing text at 2 × the cap. They reject piece tables that are not in ascending order, walk XLS records without materialising them, and buffer RTF bytes in bounded chunks. Real documents give exactly the same text as before.

## Current state

`packages/core/src/email/attachment-office-text.ts` (1103 lines, no imports, platform-neutral):
- `:18-19` `ZIP_MAX_ENTRIES = 4_096`, `ZIP_MAX_INFLATED_BYTES = 64 MiB`. There is no budget for compound files or RTF.
- `:42-46` `latin1(bytes)` builds a string with `out += String.fromCharCode(bytes[i]!)` per byte. Callers are `:57` (cp1252 fallback), `:751` and `:767` (XLS strings) and `:936` (the whole RTF source).
- `:107-121` `class DistinctValues` (`add`, `text()`) has no size limit. XLS, XLSX, XLSB and ODS use it.
- XLS `extractXlsText` `:770-834` materialises every record first:
  ```ts
  const records: Array<{ type: number; payload: Uint8Array }> = [];
  for (let pos = 0; pos + 4 <= workbook.length;) {
    ...
    records.push({ type, payload: workbook.subarray(pos + 4, pos + 4 + length) });
  ```
  SST (`:792-800`) gathers the following CONTINUE (`0x003c`) records by index and reads `unique` strings into `shared` with no size bound.
- DOC `extractDocText` `:836-888`. The piece loop at `:866-885` does `const count = Math.max(0, cpEnd - cpStart);` and then `text += decodeCp1252(…)` / `text += utf16le.decode(…)`. There is no limit on the number of pieces or the total text, and a CP array in descending order is silently tolerated.
- RTF `extractRtfText` `:935-1080`: `const source = latin1(data);` (`:936`) and `const pendingBytes: number[] = [];` (`:943`). A plain-text run pushes every byte (`:1074`: `for (let k = i; k < end; k += 1) pendingBytes.push(source.charCodeAt(k));`). The flush happens only at the next control word (`flushBytes`, `:944-948`, which calls `decodeCodepage(Uint8Array.from(pendingBytes), codepage)`).
- The cap constant is `packages/core/src/email/attachment-text.ts:9` `export const ATTACHMENT_TEXT_MAX_CHARS = 500_000;`. `capAttachmentText` (`:169-172`) collapses whitespace and then slices. `attachment-text.ts` has no imports, so importing it from `attachment-office-text.ts` creates no cycle.
- Callers (no change needed): `packages/server/src/mail-attachment-docx.ts:71-72` and `electron/email/attachment-text-docx.ts:55-56` both call `capAttachmentText(extractOfficeText(...))` inside the worker.
- Tests: `tests/unit/attachment-office-text.test.ts` (unit project). It has fixtures under `tests/fixtures/attachments/` (`angebot.doc`, `angebot.rtf`, `lieferant-ean.xls`, …), a timing-style test at `:188-205`, and a random-damage test at `:218-245`, which accepts any thrown `Error` with a string message. No CFB builder exists in the tests yet.

## Commands you will need

Prefix every command with `export PATH=/opt/node24/bin:$PATH`.

| Purpose | Command | Expected |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Focused test | `pnpm exec jest tests/unit/attachment-office-text.test.ts` | all pass |
| Worker tests (both editions use the reader) | `pnpm exec jest tests/unit/server-mail-attachment-text.test.ts` | all pass |
| Typecheck (all) | `pnpm run typecheck` | exit 0 |
| Lint | `pnpm run lint` | exit 0, 0 warnings |
| Unit | `pnpm run test:unit` | all pass |

## Scope

**In scope**: `packages/core/src/email/attachment-office-text.ts`, `tests/unit/attachment-office-text.test.ts`, `CHANGELOG.md`.

**Out of scope**:
- The ZIP formats' existing budgets.
- The worker heap and timeout (`mail-attachment-docx.ts`, `electron/email/attachment-text-docx.ts`).
- `ATTACHMENT_TEXT_MAX_BYTES`.
- Rejecting pieces whose *file positions* (FC) overlap. The spec does not forbid it, and real files might do it. The output budget already bounds the cost.

## Git workflow

- Branch `advisor/039-office-reader-budgets`.
- Commit messages in German, imperative, with an area prefix, e.g. `Office-Leser: Ausgabebudget für DOC, XLS und RTF`.
- Do NOT push or open a PR unless the operator says so.

## Steps

### Step 1: Regression tests first (they must fail)

Add these helpers to `tests/unit/attachment-office-text.test.ts`. They were checked against the current reader:
```ts
/** Minimal compound file (CFB v3, 512-byte sectors); every stream >= 4096 bytes, so no mini stream. */
function compoundFile(streams: Array<{ name: string; data: Buffer }>): Buffer {
  const S = 512;
  const counts = streams.map((s) => Math.ceil(s.data.length / S));
  const payload = 1 + counts.reduce((a, b) => a + b, 0);
  let fatSectors = 1;
  while (fatSectors * 128 < fatSectors + payload) fatSectors += 1;
  const fat = new Array<number>(fatSectors * 128).fill(0xffffffff);
  for (let i = 0; i < fatSectors; i += 1) fat[i] = 0xfffffffd;
  fat[fatSectors] = 0xfffffffe; // directory
  let next = fatSectors + 1;
  const starts = counts.map((count) => {
    const start = next;
    for (let i = 0; i < count; i += 1) fat[next + i] = i === count - 1 ? 0xfffffffe : next + i + 1;
    next += count;
    return start;
  });
  const header = Buffer.alloc(S);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header);
  header.writeUInt16LE(0x3e, 0x18); header.writeUInt16LE(3, 0x1a); header.writeUInt16LE(0xfffe, 0x1c);
  header.writeUInt16LE(9, 0x1e); header.writeUInt16LE(6, 0x20);
  header.writeUInt32LE(fatSectors, 0x2c); header.writeUInt32LE(fatSectors, 0x30); header.writeUInt32LE(4096, 0x38);
  header.writeUInt32LE(0xfffffffe, 0x3c); header.writeUInt32LE(0xfffffffe, 0x44);
  for (let i = 0; i < 109; i += 1) header.writeUInt32LE(i < fatSectors ? i : 0xffffffff, 0x4c + i * 4);
  const fatBuf = Buffer.alloc(fatSectors * S);
  fat.forEach((value, i) => fatBuf.writeUInt32LE(value >>> 0, i * 4));
  const dir = Buffer.alloc(S);
  const entry = (index: number, name: string, type: number, start: number, size: number) => {
    const n = Buffer.from(`${name}\0`, 'utf16le');
    n.copy(dir, index * 128);
    dir.writeUInt16LE(n.length, index * 128 + 0x40);
    dir[index * 128 + 0x42] = type;
    dir.writeUInt32LE(start >>> 0, index * 128 + 0x74);
    dir.writeUInt32LE(size, index * 128 + 0x78);
  };
  entry(0, 'Root Entry', 5, 0xfffffffe, 0);
  streams.forEach((s, i) => entry(i + 1, s.name, 2, starts[i]!, s.data.length));
  const bodies = streams.map((s, i) => { const b = Buffer.alloc(counts[i]! * S); s.data.copy(b); return b; });
  return Buffer.concat([header, fatBuf, dir, ...bodies]);
}

/** Word 97 file whose piece table has the given CPs; every piece points at the same run of 'A'. */
function wordDoc(cps: number[]): Buffer {
  const word = Buffer.alloc(4096);
  word.writeUInt16LE(0xa5ec, 0); word.writeUInt16LE(0x0200, 0x0a); // 1Table
  word.writeUInt16LE(14, 32); word.writeUInt16LE(22, 62); word.writeUInt16LE(93, 152);
  word.fill(0x41, 1024, 4096);
  const pieces = cps.length - 1;
  const lcb = 12 * pieces + 4;
  const table = Buffer.alloc(Math.max(4096, 5 + lcb));
  table[0] = 0x02; table.writeUInt32LE(lcb, 1);
  cps.forEach((cp, i) => table.writeUInt32LE(cp, 5 + i * 4));
  for (let i = 0; i < pieces; i += 1) table.writeUInt32LE((0x40000000 | 2048) >>> 0, 5 + (pieces + 1) * 4 + i * 8 + 2);
  word.writeUInt32LE(0, 418); word.writeUInt32LE(5 + lcb, 422); // fcClx, lcbClx
  return compoundFile([{ name: 'WordDocument', data: word }, { name: '1Table', data: table }]);
}
```
New tests. Import `OFFICE_TEXT_MAX_CHARS` from the module; it is added in Step 2, so the tests fail to compile until then.
1. `'doc: overlapping pieces stop at the output budget'`. Use `wordDoc(Array.from({ length: 5001 }, (_, i) => i * 3072))`. Expect `extract('doc', file).length` ≤ `OFFICE_TEXT_MAX_CHARS` and elapsed time < 2 000 ms. Today the result is 15 360 000 chars.
2. `'doc: a piece table out of order is refused'`. `wordDoc([0, 3072, 100])` throws `'doc piece table out of order'`. Today it returns 3 072 × `A`.
3. `'xls: distinct values stop at the output budget'`. Build a `Workbook` stream of 6 000 LABEL records (type `0x0204`, payload = 6 zero bytes + `u16` length + flags byte `0` + 200 latin1 chars, with a distinct 8-digit prefix per record) and wrap it with `compoundFile`. Expect length ≤ `OFFICE_TEXT_MAX_CHARS`. With 5 200 records, today's result is 1 045 199 chars.
4. `'rtf: plain text stops at the output budget'`. `extractRtfText(Buffer.from('{\\rtf1 ' + 'x'.repeat(3_000_000) + '}', 'latin1'))` has length ≤ `OFFICE_TEXT_MAX_CHARS` and runs in < 2 000 ms.
5. `'rtf: a multi-byte character across the flush boundary stays intact'`. `Buffer.concat([Buffer.from('{\\rtf1\\ansicpg65001 '), Buffer.from('a'.repeat(65_535) + 'ä', 'utf8'), Buffer.from('}')])` must end with `'aä'` and have length 65 536. This already passes today; it guards Step 4.

**Verify**: `pnpm exec jest tests/unit/attachment-office-text.test.ts` fails. It is a compile error on `OFFICE_TEXT_MAX_CHARS`. If you temporarily hard-code `1_000_000`, tests 1–4 fail and test 5 passes.

### Step 2: Budget constant, faster `latin1`, bounded `DistinctValues`

- Add `import { ATTACHMENT_TEXT_MAX_CHARS } from './attachment-text';` and export it:
  ```ts
  /** Readers stop producing text here; the caller's cap (after whitespace collapse) is half of it. */
  export const OFFICE_TEXT_MAX_CHARS = 2 * ATTACHMENT_TEXT_MAX_CHARS;
  ```
  Mention compound files and RTF in the header comment's "Budgets" sentence.
- `latin1`: build the string in chunks of `0x8000` bytes with `String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[])`, collect the chunks in an array and `join('')`. The output is identical.
- `DistinctValues`: count characters (`trimmed.length + 1` per value). Add `get full(): boolean` (chars ≥ `OFFICE_TEXT_MAX_CHARS`), and make `add` return early when `full`.

**Verify**: test 3 still fails (XLS does not stop reading yet, but now emits at most about 1 000 200 chars). Check it with a quick `expect` or console output; the first Step 1 test file run may still fail on it. All old tests pass.

### Step 3: XLS without the record array; DOC with order check and budget

- `extractXlsText`: replace the `records` array with a single forward loop over `pos`. Read `type`/`length` and break on overflow exactly as today. For SST, collect the CONTINUE payloads by scanning forward from the next record position with the same header parsing; the main loop later visits those CONTINUE records and ignores them (default branch), as today.
  - Stop reading SST strings once the collected shared-string characters reach `OFFICE_TEXT_MAX_CHARS`. Indexes beyond that are then skipped by the existing `index < shared.length` check.
  - After the `switch`, add `if (values.full) break;`.
  - Keep the FILEPASS throw.
- `extractDocText` piece loop:
  - `if (cpEnd < cpStart) throw new OfficeTextError('doc piece table out of order');`
  - Keep today's range checks with the *full* `count`, so out-of-range pieces still throw.
  - Then decode only `Math.min(count, OFFICE_TEXT_MAX_CHARS - text.length)` characters (bytes for compressed pieces, 2× bytes for UTF-16), and `break` once `text.length >= OFFICE_TEXT_MAX_CHARS`.

**Verify**: `pnpm exec jest tests/unit/attachment-office-text.test.ts` → tests 1–3 and all old tests pass, including the fixture tests for `angebot.doc` and `lieferant-ean.xls`.

### Step 4: RTF with chunked byte buffer and budget

In `extractRtfText`:
- Create the codepage decoder once per document. Keep the fallback order of `decodeCodepage`: `65001` → the utf-8 decoder; `1252`/`0` → cp1252 (or `latin1` if unavailable); otherwise `new TextDecoder(`windows-${cp}`)`, then `cp${cp}`, then cp1252. Wrap the result as `decode(bytes: Uint8Array, stream: boolean): string`. The `latin1`/cp1252 fallback is single-byte and ignores `stream`.
- Replace `pendingBytes: number[]` with `const pending = new Uint8Array(0x10000); let pendingLength = 0;` and a `pushByte(b)` that calls `flushBytes(false)` when the buffer is full.
- `flushBytes(final)` pushes `decoder.decode(pending.subarray(0, pendingLength), !final)` and resets the length. `emit` keeps calling `flushBytes(true)`, as today, so text before and after a control word is never merged. Only the size-triggered flush streams.
- Track `outChars` (the sum of pushed string lengths). The main loop becomes `while (i < length && outChars < OFFICE_TEXT_MAX_CHARS)`. Stop the plain-text run loop (`:1074`) when `outChars + pendingLength >= OFFICE_TEXT_MAX_CHARS`.
- At the end, `flushBytes(true)`, join, and slice to `OFFICE_TEXT_MAX_CHARS`.
- Remove `decodeCodepage` only if it has no callers left (`grep -n 'decodeCodepage(' packages/core/src/email/attachment-office-text.ts`).

**Verify**: `pnpm exec jest tests/unit/attachment-office-text.test.ts` → all pass, including tests 4 and 5, the `angebot.rtf` fixture, `rtf nested too deeply`, and the damage test.

### Step 5: Changelog and gates

`CHANGELOG.md` `[Unreleased]` `### Fixed`: `- **Beide Editionen:** Präparierte Word-97-, Excel-97- und RTF-Anhänge konnten beim Lesen für die Anhang-Suche ein Vielfaches ihrer Größe an Text und Speicher erzeugen (eine 66-KB-.doc über 15 Millionen Zeichen, bis der Worker am Speicherlimit abbrach). Die Leser hören jetzt bei der doppelten Textobergrenze auf; eine Word-Stückliste in falscher Reihenfolge wird abgewiesen. Echte Dokumente liefern denselben Text wie vorher.`

**Verify**: `pnpm run typecheck` → exit 0. `pnpm run lint` → 0 warnings. `pnpm exec jest tests/unit/server-mail-attachment-text.test.ts` → all pass. `pnpm run test:unit` → all pass.

## Test plan

Five new unit tests (Step 1): DOC budget plus timing, DOC out-of-order rejection, XLS budget, RTF budget plus timing, and an RTF chunk-boundary UTF-8 guard. The existing fixture, damage and linear-time tests must pass unchanged; they prove real files give the same text.

## Done criteria

- [ ] Tests 1–4 fail before the fix; all five pass after it.
- [ ] `grep -n "OFFICE_TEXT_MAX_CHARS" packages/core/src/email/attachment-office-text.ts` shows the export plus its uses in DOC, XLS (`DistinctValues`/SST) and RTF.
- [ ] `grep -n "records.push" packages/core/src/email/attachment-office-text.ts` → no match. `grep -n "pendingBytes" packages/core/src/email/attachment-office-text.ts` → no match.
- [ ] `pnpm run typecheck`, `pnpm run lint` and `pnpm run test:unit` pass. `git status` shows only in-scope files.
- [ ] `plans/README.md` row and `plans/MASTERPLAN.md` checkbox are updated.

## STOP conditions

- A fixture test (`angebot.doc`, `angebot.rtf`, `lieferant-ean.xls`) changes its output. The fix must be output-neutral for real files.
- `angebot.doc` or any other real document trips `doc piece table out of order`.
- Importing `./attachment-text` from `attachment-office-text.ts` breaks the core build or the Electron main build (`pnpm run typecheck`), for example through an unexpected cycle.
- The helpers in Step 1 do not produce a file the reader accepts (e.g. `not a compound file`). Report instead of changing reader validation to fit the helper.

## Maintenance notes

- Any new reader in this module must respect `OFFICE_TEXT_MAX_CHARS` while it produces text, not only after.
- Reviewers: check that the RTF `emit` path still does a *final* flush (no reordering around control words), and that the DOC range checks use the full piece length.
- Deferred: a budget for XLSX/ODS/PPTX shared-string arrays (already bounded by `ZIP_MAX_INFLATED_BYTES`).
