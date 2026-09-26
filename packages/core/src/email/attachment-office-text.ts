/**
 * Text extraction for office attachments, without third-party parsers:
 * spreadsheets (xlsx/xlsm, xlsb, xls, ods), documents (odt, rtf, doc) and
 * presentations (pptx, odp). Only text and cell values are read — nothing is
 * rendered, no macro or embedded object is touched. Callers run this in a
 * worker with its own heap limit and timeout.
 *
 * Spreadsheet numbers are written as stored (an EAN in a number cell stays
 * `4006381333931`, never `4.00638E+12`); repeated cell values are kept once,
 * so long price lists fit the text cap.
 *
 * ZIP-based formats need raw inflate, which the caller injects (node:zlib in
 * the server and desktop workers), so this module stays platform-neutral.
 * Budgets: at most ZIP_MAX_ENTRIES entries and ZIP_MAX_INFLATED_BYTES in
 * total; compound files (xls, doc) follow sector chains with loop detection.
 */

export const ZIP_MAX_ENTRIES = 4_096;
export const ZIP_MAX_INFLATED_BYTES = 64 * 1024 * 1024;

export type InflateRaw = (data: Uint8Array, maxOutputLength: number) => Uint8Array;

export type OfficeTextKind = 'xlsx' | 'xlsb' | 'xls' | 'ods' | 'odt' | 'rtf' | 'doc' | 'pptx';

export class OfficeTextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OfficeTextError';
  }
}

// ---------------------------------------------------------------------------
// Small helpers

function view(data: Uint8Array): DataView {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

const utf8 = new TextDecoder('utf-8');
const utf16le = new TextDecoder('utf-16le');

function latin1(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]!);
  return out;
}

let cp1252Decoder: TextDecoder | null | undefined;
function decodeCp1252(bytes: Uint8Array): string {
  if (cp1252Decoder === undefined) {
    try {
      cp1252Decoder = new TextDecoder('windows-1252');
    } catch {
      cp1252Decoder = null;
    }
  }
  return cp1252Decoder ? cp1252Decoder.decode(bytes) : latin1(bytes);
}

function decodeCodepage(bytes: Uint8Array, codepage: number): string {
  if (codepage === 65001) return utf8.decode(bytes);
  if (codepage === 1252 || !codepage) return decodeCp1252(bytes);
  try {
    return new TextDecoder(`windows-${codepage}`).decode(bytes);
  } catch {
    try {
      return new TextDecoder(`cp${codepage}`).decode(bytes);
    } catch {
      return decodeCp1252(bytes);
    }
  }
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function unescapeXml(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-z]{2,4});/g, (whole, entity: string) => {
    if (entity.startsWith('#x')) return safeCodePoint(parseInt(entity.slice(2), 16)) ?? whole;
    if (entity.startsWith('#')) return safeCodePoint(parseInt(entity.slice(1), 10)) ?? whole;
    return XML_ENTITIES[entity] ?? whole;
  });
}

function safeCodePoint(code: number): string | null {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return null;
  return String.fromCodePoint(code);
}

/** A number as written, without exponent for integers (EAN, article numbers). */
export function spreadsheetNumber(raw: string | number): string {
  const text = String(raw).trim();
  if (!/[eE]/.test(text)) return text;
  const value = Number(text);
  if (Number.isFinite(value) && Number.isInteger(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER) {
    return String(value);
  }
  return text;
}

function numberText(value: number): string {
  if (!Number.isFinite(value)) return '';
  if (Number.isInteger(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER) return String(value);
  return String(value);
}

/** Collects values once each, in first-seen order. */
class DistinctValues {
  private readonly seen = new Set<string>();
  private readonly values: string[] = [];

  add(value: string | null | undefined): void {
    const trimmed = (value ?? '').trim();
    if (!trimmed || this.seen.has(trimmed)) return;
    this.seen.add(trimmed);
    this.values.push(trimmed);
  }

  text(): string {
    return this.values.join('\n');
  }
}

// ---------------------------------------------------------------------------
// ZIP (central directory, stored or deflated entries)

export type ZipEntries = Map<string, Uint8Array>;

export function readZipEntries(
  data: Uint8Array,
  wanted: (name: string) => boolean,
  inflateRaw: InflateRaw,
): ZipEntries {
  const dv = view(data);
  const minEocd = 22;
  if (data.length < minEocd) throw new OfficeTextError('not a zip file');
  let eocd = -1;
  for (let i = data.length - minEocd; i >= Math.max(0, data.length - minEocd - 0xffff); i -= 1) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new OfficeTextError('zip end record missing');
  const entryCount = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  if (entryCount > ZIP_MAX_ENTRIES) throw new OfficeTextError('zip has too many entries');
  if (cdOffset + cdSize > data.length) throw new OfficeTextError('zip directory out of range');

  const entries: ZipEntries = new Map();
  let inflatedTotal = 0;
  let pos = cdOffset;
  for (let n = 0; n < entryCount; n += 1) {
    if (pos + 46 > data.length || dv.getUint32(pos, true) !== 0x02014b50) {
      throw new OfficeTextError('zip directory damaged');
    }
    const flags = dv.getUint16(pos + 8, true);
    const method = dv.getUint16(pos + 10, true);
    const compressedSize = dv.getUint32(pos + 20, true);
    const size = dv.getUint32(pos + 24, true);
    const nameLength = dv.getUint16(pos + 28, true);
    const extraLength = dv.getUint16(pos + 30, true);
    const commentLength = dv.getUint16(pos + 32, true);
    const localOffset = dv.getUint32(pos + 42, true);
    const name = utf8.decode(data.subarray(pos + 46, pos + 46 + nameLength));
    pos += 46 + nameLength + extraLength + commentLength;
    if (!wanted(name)) continue;
    if (flags & 0x1) throw new OfficeTextError('zip entry is encrypted');
    if (compressedSize === 0xffffffff || size === 0xffffffff) throw new OfficeTextError('zip64 is not supported');
    if (localOffset + 30 > data.length || dv.getUint32(localOffset, true) !== 0x04034b50) {
      throw new OfficeTextError('zip local header damaged');
    }
    const dataStart = localOffset + 30 + dv.getUint16(localOffset + 26, true) + dv.getUint16(localOffset + 28, true);
    if (dataStart + compressedSize > data.length) throw new OfficeTextError('zip entry out of range');
    const raw = data.subarray(dataStart, dataStart + compressedSize);
    const budget = ZIP_MAX_INFLATED_BYTES - inflatedTotal;
    let content: Uint8Array;
    if (method === 0) {
      content = raw;
    } else if (method === 8) {
      content = inflateRaw(raw, budget);
    } else {
      throw new OfficeTextError(`zip compression method ${method} is not supported`);
    }
    inflatedTotal += content.length;
    if (inflatedTotal > ZIP_MAX_INFLATED_BYTES) throw new OfficeTextError('zip inflates beyond the limit');
    entries.set(name, content);
  }
  return entries;
}

/** Entry by name, ignoring case (some generators write `xl/SharedStrings.xml`). */
function findEntry(entries: ZipEntries, name: string): Uint8Array | undefined {
  const exact = entries.get(name);
  if (exact) return exact;
  const lower = name.toLowerCase();
  for (const [candidate, content] of entries) {
    if (candidate.toLowerCase() === lower) return content;
  }
  return undefined;
}

function sortedEntries(entries: ZipEntries, pattern: RegExp): Uint8Array[] {
  return [...entries.keys()]
    .filter((name) => pattern.test(name))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    .map((name) => entries.get(name)!);
}

// ---------------------------------------------------------------------------
// XML: a linear tokenizer instead of regular expressions over whole documents
// (a lazy pattern like `<c ...>[\s\S]*?</c>` backtracks quadratically on
// crafted input). Only indexOf moves forward; every character is read a
// constant number of times.

type XmlToken =
  | { kind: 'text'; text: string }
  | { kind: 'open'; name: string; attrs: string; selfClosing: boolean }
  | { kind: 'close'; name: string };

function* xmlTokens(xml: string): Generator<XmlToken> {
  let pos = 0;
  while (pos < xml.length) {
    const lt = xml.indexOf('<', pos);
    if (lt < 0) {
      yield { kind: 'text', text: unescapeXml(xml.slice(pos)) };
      return;
    }
    if (lt > pos) yield { kind: 'text', text: unescapeXml(xml.slice(pos, lt)) };
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      if (end < 0) return;
      yield { kind: 'text', text: xml.slice(lt + 9, end) };
      pos = end + 3;
      continue;
    }
    const closer = xml.startsWith('<!--', lt) ? '-->' : xml.startsWith('<?', lt) ? '?>' : '>';
    const gt = xml.indexOf(closer, lt + 1);
    if (gt < 0) return;
    pos = gt + closer.length;
    if (closer !== '>' || xml[lt + 1] === '!') continue;
    const inner = xml.slice(lt + 1, gt);
    if (inner.startsWith('/')) {
      yield { kind: 'close', name: inner.slice(1).trim() };
      continue;
    }
    const selfClosing = inner.endsWith('/');
    const body = selfClosing ? inner.slice(0, -1) : inner;
    let nameEnd = 0;
    while (nameEnd < body.length && !isXmlSpace(body.charCodeAt(nameEnd))) nameEnd += 1;
    yield { kind: 'open', name: body.slice(0, nameEnd), attrs: body.slice(nameEnd), selfClosing };
  }
}

function isXmlSpace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

/** Element name without namespace prefix (`x:c` -> `c`). */
function localName(name: string): string {
  return name.slice(name.indexOf(':') + 1);
}

/** Attribute value (single or double quotes), or undefined. */
function xmlAttribute(attrs: string, name: string): string | undefined {
  for (let from = 0; ;) {
    const at = attrs.indexOf(name, from);
    if (at < 0) return undefined;
    from = at + 1;
    if (at > 0 && !isXmlSpace(attrs.charCodeAt(at - 1))) continue;
    let i = at + name.length;
    while (isXmlSpace(attrs.charCodeAt(i))) i += 1;
    if (attrs[i] !== '=') continue;
    i += 1;
    while (isXmlSpace(attrs.charCodeAt(i))) i += 1;
    const quote = attrs[i];
    if (quote !== '"' && quote !== "'") continue;
    const end = attrs.indexOf(quote, i + 1);
    if (end < 0) return undefined;
    return unescapeXml(attrs.slice(i + 1, end));
  }
}

function collapseSpaces(text: string): string {
  return text.replace(/[ \t]+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// XLSX / XLSM (SpreadsheetML)

const XLSX_SHARED_STRINGS = /^xl\/sharedstrings\.xml$/i;
const XLSX_SHEET = /^xl\/worksheets\/sheet[^/]*\.xml$/i;

// Element names may carry a namespace prefix (`<x:c>` from .NET exports).
function xlsxSharedStrings(xml: string): string[] {
  const shared: string[] = [];
  let item: string[] | null = null;
  let inText = false;
  for (const token of xmlTokens(xml)) {
    if (token.kind === 'text') {
      if (item && inText) item.push(token.text);
      continue;
    }
    const local = localName(token.name);
    if (token.kind === 'open') {
      if (local === 'si') {
        if (token.selfClosing) shared.push('');
        else item = [];
      } else if (local === 't' && !token.selfClosing) {
        inText = true;
      }
    } else if (local === 't') {
      inText = false;
    } else if (local === 'si' && item) {
      shared.push(item.join(''));
      item = null;
    }
  }
  return shared;
}

type XlsxCell = { type: string; value: string | null; inline: string[]; in: 'v' | 't' | null };

function addXlsxCell(values: DistinctValues, cell: XlsxCell, shared: readonly string[]): void {
  if (cell.type === 's') {
    const index = Number(cell.value);
    if (cell.value !== null && Number.isInteger(index) && index >= 0 && index < shared.length) values.add(shared[index]);
  } else if (cell.type === 'inlineStr') {
    values.add(cell.inline.join(''));
  } else if (cell.type === 'str' || cell.type === 'e') {
    if (cell.value !== null) values.add(cell.value);
  } else if (cell.type !== 'b' && cell.value !== null) {
    values.add(spreadsheetNumber(cell.value));
  }
}

export function extractXlsxText(entries: ZipEntries): string {
  const sst = findEntry(entries, 'xl/sharedStrings.xml');
  const shared = sst ? xlsxSharedStrings(utf8.decode(sst)) : [];
  const values = new DistinctValues();
  for (const sheet of sortedEntries(entries, XLSX_SHEET)) {
    let cell: XlsxCell | null = null;
    for (const token of xmlTokens(utf8.decode(sheet))) {
      if (token.kind === 'text') {
        if (cell?.in === 'v') cell.value = (cell.value ?? '') + token.text;
        else if (cell?.in === 't') cell.inline.push(token.text);
        continue;
      }
      const local = localName(token.name);
      if (token.kind === 'open') {
        if (local === 'c' && !token.selfClosing) {
          cell = { type: xmlAttribute(token.attrs, 't') ?? 'n', value: null, inline: [], in: null };
        } else if (cell && !token.selfClosing && (local === 'v' || local === 't')) {
          cell.in = local;
          if (local === 'v') cell.value ??= '';
        }
      } else if (cell && (local === 'v' || local === 't')) {
        cell.in = null;
      } else if (cell && local === 'c') {
        addXlsxCell(values, cell, shared);
        cell = null;
      }
    }
  }
  return values.text();
}

// ---------------------------------------------------------------------------
// PPTX (PresentationML): <a:t> of slides and notes, one line per paragraph

const PPTX_PARTS = /^ppt\/(slides\/slide|notesSlides\/notesSlide)[^/]*\.xml$/;

export function extractPptxText(entries: ZipEntries): string {
  const parts: string[] = [];
  for (const slide of sortedEntries(entries, PPTX_PARTS)) {
    let paragraph: string[] = [];
    let inText = false;
    const flush = () => {
      const text = paragraph.join('');
      if (text.trim()) parts.push(text);
      paragraph = [];
    };
    for (const token of xmlTokens(utf8.decode(slide))) {
      if (token.kind === 'text') {
        if (inText) paragraph.push(token.text);
      } else if (localName(token.name) === 't') {
        inText = token.kind === 'open' && !token.selfClosing;
      } else if (token.kind === 'close' && localName(token.name) === 'p') {
        flush();
      }
    }
    flush();
  }
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// OpenDocument (odt, ods, odp): content.xml; cell values from office:value

export function extractOdfText(entries: ZipEntries, spreadsheet: boolean): string {
  const content = findEntry(entries, 'content.xml');
  if (!content) throw new OfficeTextError('OpenDocument without content.xml');
  const xml = utf8.decode(content);
  let inBody = !xml.includes('<office:body');
  if (spreadsheet) {
    const values = new DistinctValues();
    let cell: { numeric: string | undefined; parts: string[]; depth: number } | null = null;
    for (const token of xmlTokens(xml)) {
      if (!inBody) {
        inBody = token.kind === 'open' && token.name === 'office:body';
        continue;
      }
      if (token.kind === 'text') {
        cell?.parts.push(token.text);
      } else if (token.name === 'table:table-cell' && token.kind === 'open') {
        if (cell) {
          if (!token.selfClosing) cell.depth += 1;
          continue;
        }
        const numeric = xmlAttribute(token.attrs, 'office:value');
        if (token.selfClosing) {
          if (numeric !== undefined) values.add(spreadsheetNumber(numeric));
        } else {
          cell = { numeric, parts: [], depth: 1 };
        }
      } else if (cell && token.name === 'table:table-cell' && token.kind === 'close' && --cell.depth === 0) {
        if (cell.numeric !== undefined) values.add(spreadsheetNumber(cell.numeric));
        const text = collapseSpaces(cell.parts.join(''));
        if (text && text !== cell.numeric) values.add(text);
        cell = null;
      } else {
        cell?.parts.push(' ');
      }
    }
    return values.text();
  }
  const parts: string[] = [];
  for (const token of xmlTokens(xml)) {
    if (!inBody) {
      inBody = token.kind === 'open' && token.name === 'office:body';
      continue;
    }
    if (token.kind === 'text') parts.push(token.text);
    else if (token.kind === 'close') parts.push(token.name === 'text:p' || token.name === 'text:h' ? '\n' : ' ');
    else if (token.name === 'text:tab') parts.push('\t');
    else if (token.name === 'text:line-break') parts.push('\n');
    else parts.push(' ');
  }
  return collapseSpaces(parts.join(''));
}

// ---------------------------------------------------------------------------
// XLSB (BIFF12 records)

class Biff12Reader {
  private pos = 0;
  constructor(private readonly data: Uint8Array) {}

  private varint(maxBytes: number): number | null {
    let value = 0;
    for (let i = 0; i < maxBytes; i += 1) {
      if (this.pos >= this.data.length) return null;
      const byte = this.data[this.pos++]!;
      value |= (byte & 0x7f) << (7 * i);
      if ((byte & 0x80) === 0) return value >>> 0;
    }
    return value >>> 0;
  }

  next(): { type: number; payload: Uint8Array } | null {
    if (this.pos >= this.data.length) return null;
    const type = this.varint(2);
    const size = this.varint(4);
    if (type === null || size === null) return null;
    if (this.pos + size > this.data.length) throw new OfficeTextError('xlsb record out of range');
    const payload = this.data.subarray(this.pos, this.pos + size);
    this.pos += size;
    return { type, payload };
  }
}

function xlWideString(payload: Uint8Array, offset: number): string | null {
  if (offset + 4 > payload.length) return null;
  const count = view(payload).getUint32(offset, true);
  const end = offset + 4 + count * 2;
  if (end > payload.length) return null;
  return utf16le.decode(payload.subarray(offset + 4, end));
}

function rkNumber(rk: number): number {
  const scaled = (rk & 0x01) !== 0;
  let value: number;
  if ((rk & 0x02) !== 0) {
    value = rk >> 2;
  } else {
    const bytes = new DataView(new ArrayBuffer(8));
    bytes.setUint32(4, rk & 0xfffffffc, true);
    value = bytes.getFloat64(0, true);
  }
  return scaled ? value / 100 : value;
}

const XLSB_SHARED_STRINGS = /^xl\/sharedstrings\.bin$/i;
const XLSB_SHEET = /^xl\/worksheets\/sheet[^/]*\.bin$/i;

export function extractXlsbText(entries: ZipEntries): string {
  const shared: string[] = [];
  const sst = findEntry(entries, 'xl/sharedStrings.bin');
  if (sst) {
    const reader = new Biff12Reader(sst);
    for (let record = reader.next(); record; record = reader.next()) {
      // BrtSSTItem: RichStr = flags (1 byte) + XLWideString
      if (record.type === 19) shared.push(xlWideString(record.payload, 1) ?? '');
    }
  }
  const values = new DistinctValues();
  for (const sheet of sortedEntries(entries, XLSB_SHEET)) {
    const reader = new Biff12Reader(sheet);
    for (let record = reader.next(); record; record = reader.next()) {
      const { type, payload } = record;
      if (payload.length < 8) continue;
      const dv = view(payload);
      switch (type) {
        case 2: // BrtCellRk
          if (payload.length >= 12) values.add(numberText(rkNumber(dv.getInt32(8, true))));
          break;
        case 5: // BrtCellReal
        case 9: // BrtFmlaNum
          if (payload.length >= 16) values.add(numberText(dv.getFloat64(8, true)));
          break;
        case 6: // BrtCellSt
        case 8: // BrtFmlaString
          values.add(xlWideString(payload, 8));
          break;
        case 7: { // BrtCellIsst
          if (payload.length >= 12) {
            const index = dv.getUint32(8, true);
            if (index < shared.length) values.add(shared[index]);
          }
          break;
        }
        default:
          break;
      }
    }
  }
  return values.text();
}

// ---------------------------------------------------------------------------
// Compound File Binary (xls, doc)

const CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const MAX_REGULAR_SECTOR = 0xfffffffa;

export class CompoundFile {
  private readonly dv: DataView;
  private readonly sectorSize: number;
  private readonly miniSectorSize: number;
  private readonly miniCutoff: number;
  private readonly fat: number[] = [];
  private readonly miniFat: number[] = [];
  private readonly entries: Array<{ name: string; type: number; start: number; size: number }> = [];
  private miniStream: Uint8Array = new Uint8Array(0);

  constructor(private readonly data: Uint8Array) {
    if (data.length < 512 || CFB_SIGNATURE.some((byte, i) => data[i] !== byte)) {
      throw new OfficeTextError('not a compound file');
    }
    this.dv = view(data);
    const sectorShift = this.dv.getUint16(0x1e, true);
    const miniShift = this.dv.getUint16(0x20, true);
    if (sectorShift !== 9 && sectorShift !== 12) throw new OfficeTextError('compound file sector size');
    if (miniShift !== 6) throw new OfficeTextError('compound file mini sector size');
    this.sectorSize = 1 << sectorShift;
    this.miniSectorSize = 1 << miniShift;
    this.miniCutoff = this.dv.getUint32(0x38, true);
    const fatSectors = this.dv.getUint32(0x2c, true);
    const firstDirSector = this.dv.getUint32(0x30, true);
    const firstMiniFat = this.dv.getUint32(0x3c, true);
    const miniFatCount = this.dv.getUint32(0x40, true);
    let difatSector = this.dv.getUint32(0x44, true);
    const difatCount = this.dv.getUint32(0x48, true);

    const fatSectorList: number[] = [];
    for (let i = 0; i < 109 && fatSectorList.length < fatSectors; i += 1) {
      fatSectorList.push(this.dv.getUint32(0x4c + i * 4, true));
    }
    const seenDifat = new Set<number>();
    for (let n = 0; n < difatCount && difatSector <= MAX_REGULAR_SECTOR && fatSectorList.length < fatSectors; n += 1) {
      if (seenDifat.has(difatSector)) throw new OfficeTextError('compound file DIFAT loop');
      seenDifat.add(difatSector);
      const offset = this.sectorOffset(difatSector);
      const perSector = this.sectorSize / 4 - 1;
      for (let i = 0; i < perSector && fatSectorList.length < fatSectors; i += 1) {
        fatSectorList.push(this.dv.getUint32(offset + i * 4, true));
      }
      difatSector = this.dv.getUint32(offset + perSector * 4, true);
    }
    for (const sector of fatSectorList) {
      const offset = this.sectorOffset(sector);
      for (let i = 0; i < this.sectorSize / 4; i += 1) this.fat.push(this.dv.getUint32(offset + i * 4, true));
    }
    if (miniFatCount > 0 && firstMiniFat <= MAX_REGULAR_SECTOR) {
      const miniFatBytes = this.readChain(firstMiniFat, miniFatCount * this.sectorSize);
      const miniView = view(miniFatBytes);
      for (let i = 0; i + 4 <= miniFatBytes.length; i += 4) this.miniFat.push(miniView.getUint32(i, true));
    }
    const directory = this.readChain(firstDirSector, Number.POSITIVE_INFINITY);
    const dirView = view(directory);
    for (let offset = 0; offset + 128 <= directory.length; offset += 128) {
      const nameLength = Math.min(dirView.getUint16(offset + 0x40, true), 64);
      const name = nameLength >= 2 ? utf16le.decode(directory.subarray(offset, offset + nameLength - 2)) : '';
      this.entries.push({
        name,
        type: directory[offset + 0x42]!,
        start: dirView.getUint32(offset + 0x74, true),
        size: dirView.getUint32(offset + 0x78, true),
      });
    }
    const root = this.entries[0];
    if (root && root.type === 5 && root.start <= MAX_REGULAR_SECTOR) {
      this.miniStream = this.readChain(root.start, root.size);
    }
  }

  private sectorOffset(sector: number): number {
    const offset = (sector + 1) * this.sectorSize;
    if (sector > MAX_REGULAR_SECTOR || offset + this.sectorSize > this.data.length) {
      throw new OfficeTextError('compound file sector out of range');
    }
    return offset;
  }

  private readChain(start: number, size: number): Uint8Array {
    const parts: Uint8Array[] = [];
    let total = 0;
    const seen = new Set<number>();
    for (let sector = start; sector !== ENDOFCHAIN && sector !== FREESECT; sector = this.fat[sector] ?? ENDOFCHAIN) {
      if (seen.has(sector)) throw new OfficeTextError('compound file sector loop');
      seen.add(sector);
      const offset = this.sectorOffset(sector);
      parts.push(this.data.subarray(offset, offset + this.sectorSize));
      total += this.sectorSize;
      if (total >= size) break;
    }
    const joined = concat(parts);
    return Number.isFinite(size) ? joined.subarray(0, Math.min(size, joined.length)) : joined;
  }

  private readMiniChain(start: number, size: number): Uint8Array {
    const parts: Uint8Array[] = [];
    let total = 0;
    const seen = new Set<number>();
    for (let sector = start; sector !== ENDOFCHAIN && sector !== FREESECT; sector = this.miniFat[sector] ?? ENDOFCHAIN) {
      if (seen.has(sector)) throw new OfficeTextError('compound file mini sector loop');
      seen.add(sector);
      const offset = sector * this.miniSectorSize;
      if (offset + this.miniSectorSize > this.miniStream.length) throw new OfficeTextError('mini sector out of range');
      parts.push(this.miniStream.subarray(offset, offset + this.miniSectorSize));
      total += this.miniSectorSize;
      if (total >= size) break;
    }
    return concat(parts).subarray(0, size);
  }

  stream(name: string): Uint8Array | null {
    const entry = this.entries.find((candidate) => candidate.type === 2 && candidate.name.toLowerCase() === name.toLowerCase());
    if (!entry) return null;
    if (entry.size < this.miniCutoff) return this.readMiniChain(entry.start, entry.size);
    return this.readChain(entry.start, entry.size);
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// XLS (BIFF8 in a compound file)

/** Reads BIFF8 strings that may continue into following CONTINUE records. */
class BiffSegments {
  private segment = 0;
  private pos = 0;
  constructor(private readonly segments: Uint8Array[], startPos: number) {
    this.pos = startPos;
  }

  private current(): Uint8Array | null {
    while (this.segment < this.segments.length && this.pos >= this.segments[this.segment]!.length) {
      this.segment += 1;
      this.pos = 0;
    }
    return this.segments[this.segment] ?? null;
  }

  u8(): number {
    const seg = this.current();
    if (!seg) throw new OfficeTextError('xls string out of range');
    return seg[this.pos++]!;
  }

  u16(): number {
    return this.u8() | (this.u8() << 8);
  }

  u32(): number {
    return (this.u16() | (this.u16() << 16)) >>> 0;
  }

  skip(count: number): void {
    for (let i = 0; i < count; i += 1) this.u8();
  }

  /** XLUnicodeRichExtendedString: characters may continue in the next segment with a new flags byte. */
  string(): string {
    const count = this.u16();
    let flags = this.u8();
    const rich = (flags & 0x08) !== 0 ? this.u16() : 0;
    const ext = (flags & 0x04) !== 0 ? this.u32() : 0;
    let out = '';
    let remaining = count;
    while (remaining > 0) {
      const seg = this.segments[this.segment];
      if (!seg) throw new OfficeTextError('xls string out of range');
      if (this.pos >= seg.length) {
        // The characters continue in the next CONTINUE record, which starts
        // with its own flags byte (compressed or UTF-16).
        this.segment += 1;
        this.pos = 0;
        const next = this.segments[this.segment];
        if (!next || next.length === 0) throw new OfficeTextError('xls string out of range');
        flags = next[this.pos++]!;
        continue;
      }
      const wide = (flags & 0x01) !== 0;
      const available = Math.floor((seg.length - this.pos) / (wide ? 2 : 1));
      if (available === 0) throw new OfficeTextError('xls string split inside a character');
      const take = Math.min(remaining, available);
      const bytes = seg.subarray(this.pos, this.pos + take * (wide ? 2 : 1));
      out += wide ? utf16le.decode(bytes) : latin1(bytes);
      this.pos += bytes.length;
      remaining -= take;
    }
    this.skip(rich * 4 + ext);
    return out;
  }
}

function xlsShortString(payload: Uint8Array, offset: number): string | null {
  if (offset + 3 > payload.length) return null;
  const count = view(payload).getUint16(offset, true);
  const wide = (payload[offset + 2]! & 0x01) !== 0;
  const end = offset + 3 + count * (wide ? 2 : 1);
  if (end > payload.length) return null;
  const bytes = payload.subarray(offset + 3, end);
  return wide ? utf16le.decode(bytes) : latin1(bytes);
}

export function extractXlsText(data: Uint8Array): string {
  const cfb = new CompoundFile(data);
  const workbook = cfb.stream('Workbook') ?? cfb.stream('Book');
  if (!workbook) throw new OfficeTextError('xls without workbook stream');
  const dv = view(workbook);
  const records: Array<{ type: number; payload: Uint8Array }> = [];
  for (let pos = 0; pos + 4 <= workbook.length;) {
    const type = dv.getUint16(pos, true);
    const length = dv.getUint16(pos + 2, true);
    if (pos + 4 + length > workbook.length) break;
    records.push({ type, payload: workbook.subarray(pos + 4, pos + 4 + length) });
    pos += 4 + length;
  }
  const shared: string[] = [];
  const values = new DistinctValues();
  for (let i = 0; i < records.length; i += 1) {
    const { type, payload } = records[i]!;
    const p = view(payload);
    switch (type) {
      case 0x002f: // FILEPASS: the rest is encrypted, reading on would index noise
        throw new OfficeTextError('xls is encrypted');
      case 0x00fc: { // SST (+ CONTINUE)
        const segments = [payload];
        for (let j = i + 1; j < records.length && records[j]!.type === 0x003c; j += 1) segments.push(records[j]!.payload);
        const reader = new BiffSegments(segments, 0);
        reader.u32();
        const unique = reader.u32();
        for (let n = 0; n < unique; n += 1) shared.push(reader.string());
        break;
      }
      case 0x00fd: // LABELSST
        if (payload.length >= 10) {
          const index = p.getUint32(6, true);
          if (index < shared.length) values.add(shared[index]);
        }
        break;
      case 0x0204: // LABEL
        values.add(xlsShortString(payload, 6));
        break;
      case 0x0203: // NUMBER
        if (payload.length >= 14) values.add(numberText(p.getFloat64(6, true)));
        break;
      case 0x027e: // RK
        if (payload.length >= 10) values.add(numberText(rkNumber(p.getInt32(6, true))));
        break;
      case 0x00bd: // MULRK
        for (let offset = 4; offset + 6 <= payload.length - 2; offset += 6) {
          values.add(numberText(rkNumber(p.getInt32(offset + 2, true))));
        }
        break;
      case 0x0006: // FORMULA: cached number unless the last two bytes are 0xFFFF
        if (payload.length >= 14 && p.getUint16(12, true) !== 0xffff) values.add(numberText(p.getFloat64(6, true)));
        break;
      case 0x0207: // STRING (cached formula text)
        values.add(xlsShortString(payload, 0));
        break;
      default:
        break;
    }
  }
  return values.text();
}

// ---------------------------------------------------------------------------
// DOC (Word 97-2003): piece table from the CLX in the table stream

export function extractDocText(data: Uint8Array): string {
  const cfb = new CompoundFile(data);
  const word = cfb.stream('WordDocument');
  if (!word || word.length < 0x200) throw new OfficeTextError('doc without WordDocument stream');
  const wv = view(word);
  if (wv.getUint16(0, true) !== 0xa5ec) throw new OfficeTextError('doc has no Word 97 file information block');
  const flags = wv.getUint16(0x0a, true);
  if (flags & 0x0100) throw new OfficeTextError('doc is encrypted');
  const table = cfb.stream(flags & 0x0200 ? '1Table' : '0Table');
  if (!table) throw new OfficeTextError('doc without table stream');

  let offset = 32;
  const csw = wv.getUint16(offset, true);
  offset += 2 + csw * 2;
  const cslw = wv.getUint16(offset, true);
  offset += 2 + cslw * 4;
  const cbRgFcLcb = wv.getUint16(offset, true);
  offset += 2;
  if (cbRgFcLcb < 34) throw new OfficeTextError('doc file information block too short');
  const fcClx = wv.getUint32(offset + 33 * 8, true);
  const lcbClx = wv.getUint32(offset + 33 * 8 + 4, true);
  if (fcClx + lcbClx > table.length || lcbClx === 0) throw new OfficeTextError('doc piece table out of range');
  const clx = table.subarray(fcClx, fcClx + lcbClx);
  const cv = view(clx);
  let pos = 0;
  while (pos < clx.length && clx[pos] === 0x01) {
    pos += 3 + cv.getUint16(pos + 1, true);
  }
  if (clx[pos] !== 0x02) throw new OfficeTextError('doc piece table missing');
  const lcb = cv.getUint32(pos + 1, true);
  const plc = clx.subarray(pos + 5, pos + 5 + lcb);
  const pieces = Math.floor((plc.length - 4) / 12);
  const pv = view(plc);
  let text = '';
  for (let i = 0; i < pieces; i += 1) {
    const cpStart = pv.getUint32(i * 4, true);
    const cpEnd = pv.getUint32((i + 1) * 4, true);
    const pcd = (pieces + 1) * 4 + i * 8;
    const fcRaw = pv.getUint32(pcd + 2, true);
    const compressed = (fcRaw & 0x40000000) !== 0;
    const fc = fcRaw & 0x3fffffff;
    const count = Math.max(0, cpEnd - cpStart);
    if (compressed) {
      const start = fc / 2;
      if (start + count > word.length) throw new OfficeTextError('doc piece out of range');
      text += decodeCp1252(word.subarray(start, start + count));
    } else {
      if (fc + count * 2 > word.length) throw new OfficeTextError('doc piece out of range');
      text += utf16le.decode(word.subarray(fc, fc + count * 2));
    }
  }
  return cleanWordText(text);
}

/** Word control characters: field codes out, cell/paragraph marks as breaks. */
function cleanWordText(text: string): string {
  // Field: 0x13 instruction 0x14 result 0x15 -> keep the result only.
  let out = '';
  let depth = 0;
  let inInstruction: boolean[] = [];
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code === 0x13) {
      depth += 1;
      inInstruction.push(true);
      continue;
    }
    if (code === 0x14) {
      if (depth > 0) inInstruction[depth - 1] = false;
      continue;
    }
    if (code === 0x15) {
      if (depth > 0) {
        depth -= 1;
        inInstruction = inInstruction.slice(0, depth);
      }
      continue;
    }
    if (depth > 0 && inInstruction[depth - 1]) continue;
    if (code === 0x0d || code === 0x0b || code === 0x0c) out += '\n';
    else if (code === 0x07) out += '\t';
    else if (code === 0x09 || code >= 0x20) out += char;
  }
  return out;
}

// ---------------------------------------------------------------------------
// RTF

const RTF_SKIP_DESTINATIONS = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'listtable', 'listoverridetable', 'rsidtbl', 'generator',
  'pict', 'object', 'themedata', 'colorschememapping', 'datastore', 'latentstyles', 'xmlnstbl',
  'mmathPr', 'filetbl', 'revtbl', 'info', 'fldinst', 'shpinst', 'nonshppict', 'bkmkstart', 'bkmkend',
  'pgdsctbl', 'protusertbl', 'ftnsep', 'ftnsepc', 'aftnsep', 'aftnsepc', 'wgrffmtfilter', 'blipuid',
]);

/** Real documents nest a few dozen groups; a crafted file could nest millions. */
const RTF_MAX_DEPTH = 1_024;

export function extractRtfText(data: Uint8Array): string {
  const source = latin1(data);
  if (!source.startsWith('{\\rtf')) throw new OfficeTextError('not an rtf file');
  let codepage = 1252;
  const cpMatch = /\\ansicpg(\d{3,5})/.exec(source.slice(0, 2048));
  if (cpMatch) codepage = Number(cpMatch[1]);

  const out: string[] = [];
  const pendingBytes: number[] = [];
  const flushBytes = () => {
    if (pendingBytes.length === 0) return;
    out.push(decodeCodepage(Uint8Array.from(pendingBytes), codepage));
    pendingBytes.length = 0;
  };
  const emit = (text: string) => {
    flushBytes();
    out.push(text);
  };

  type Group = { skip: boolean; uc: number };
  const stack: Group[] = [];
  let group: Group = { skip: false, uc: 1 };
  let skipChars = 0;
  let i = 0;
  const length = source.length;
  while (i < length) {
    const char = source[i]!;
    if (char === '{') {
      if (stack.length >= RTF_MAX_DEPTH) throw new OfficeTextError('rtf nested too deeply');
      stack.push(group);
      group = { ...group };
      i += 1;
      continue;
    }
    if (char === '}') {
      group = stack.pop() ?? { skip: false, uc: 1 };
      i += 1;
      continue;
    }
    if (char === '\\') {
      const next = source[i + 1] ?? '';
      if (next === '\\' || next === '{' || next === '}') {
        if (skipChars > 0) skipChars -= 1;
        else if (!group.skip) emit(next);
        i += 2;
        continue;
      }
      if (next === "'") {
        const byte = parseInt(source.slice(i + 2, i + 4), 16);
        i += 4;
        if (skipChars > 0) {
          skipChars -= 1;
          continue;
        }
        if (!group.skip && Number.isFinite(byte)) pendingBytes.push(byte);
        continue;
      }
      if (next === '*') {
        group.skip = true;
        i += 2;
        continue;
      }
      if (next === '~') {
        if (!group.skip) emit(' ');
        i += 2;
        continue;
      }
      if (next === '-' || next === '_') {
        if (!group.skip && next === '_') emit('-');
        i += 2;
        continue;
      }
      if (next === '\r' || next === '\n') {
        if (!group.skip) emit('\n');
        i += 2;
        continue;
      }
      const word = /^[a-zA-Z]{1,32}/.exec(source.slice(i + 1, i + 33))?.[0];
      if (!word) {
        i += 2;
        continue;
      }
      let j = i + 1 + word.length;
      const numberMatch = /^-?\d{1,10}/.exec(source.slice(j, j + 11));
      const param = numberMatch ? Number(numberMatch[0]) : null;
      if (numberMatch) j += numberMatch[0].length;
      if (source[j] === ' ') j += 1;
      i = j;
      if (word === 'bin' && param !== null && param > 0) {
        i += param;
        continue;
      }
      if (RTF_SKIP_DESTINATIONS.has(word)) {
        group.skip = true;
        continue;
      }
      if (group.skip) continue;
      switch (word) {
        case 'par':
        case 'line':
        case 'row':
        case 'sect':
        case 'page':
          emit('\n');
          break;
        case 'tab':
        case 'cell':
          emit('\t');
          break;
        case 'uc':
          group.uc = param ?? 1;
          break;
        case 'u':
          if (param !== null) {
            emit(String.fromCharCode(param < 0 ? param + 65536 : param));
            skipChars = group.uc;
          }
          break;
        default:
          break;
      }
      continue;
    }
    if (char === '\r' || char === '\n') {
      i += 1;
      continue;
    }
    if (skipChars > 0) {
      skipChars -= 1;
      i += 1;
      continue;
    }
    if (!group.skip) {
      // Plain text runs: take everything up to the next control character at once.
      let end = i + 1;
      while (end < length && source[end] !== '\\' && source[end] !== '{' && source[end] !== '}' && source[end] !== '\r' && source[end] !== '\n') end += 1;
      for (let k = i; k < end; k += 1) pendingBytes.push(source.charCodeAt(k));
      i = end;
      continue;
    }
    i += 1;
  }
  flushBytes();
  return out.join('');
}

// ---------------------------------------------------------------------------
// Dispatch

export function extractOfficeText(kind: OfficeTextKind, data: Uint8Array, inflateRaw: InflateRaw): string {
  switch (kind) {
    case 'xlsx':
      return extractXlsxText(readZipEntries(data, (name) => XLSX_SHARED_STRINGS.test(name) || XLSX_SHEET.test(name), inflateRaw));
    case 'xlsb':
      return extractXlsbText(readZipEntries(data, (name) => XLSB_SHARED_STRINGS.test(name) || XLSB_SHEET.test(name), inflateRaw));
    case 'pptx':
      return extractPptxText(readZipEntries(data, (name) => PPTX_PARTS.test(name), inflateRaw));
    case 'ods':
      return extractOdfText(readZipEntries(data, (name) => name.toLowerCase() === 'content.xml', inflateRaw), true);
    case 'odt':
      return extractOdfText(readZipEntries(data, (name) => name.toLowerCase() === 'content.xml', inflateRaw), false);
    case 'xls':
      return extractXlsText(data);
    case 'doc':
      return extractDocText(data);
    case 'rtf':
      return extractRtfText(data);
  }
}
