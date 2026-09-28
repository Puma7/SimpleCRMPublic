import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

import JSZip from 'jszip';

import {
  decodeAttachmentText,
  refineAttachmentTextKind,
} from '../../packages/core/src/email/attachment-text';
import {
  extractOfficeText,
  extractRtfText,
  OFFICE_TEXT_MAX_CHARS,
  spreadsheetNumber,
  type OfficeTextKind,
} from '../../packages/core/src/email/attachment-office-text';

/**
 * Anhang-Suche über Office-Formate: Lieferanten schicken Preislisten als CSV,
 * xlsx, xls oder xlsb; gesucht wird oft nach der EAN. Die Testdateien unter
 * tests/fixtures/attachments sind mit LibreOffice erzeugt (die EAN steht dort
 * als Zahlenzelle, der schwierigste Fall); xlsb und pptx werden hier gebaut.
 */
const fixture = (name: string) => readFileSync(join(__dirname, '../fixtures/attachments', name));
const inflate = (data: Uint8Array, max: number) => inflateRawSync(data, { maxOutputLength: max });
const extract = (kind: OfficeTextKind, data: Uint8Array) => extractOfficeText(kind, data, inflate);

const EAN = '4006381333931';

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
  header.writeUInt16LE(0x3e, 0x18);
  header.writeUInt16LE(3, 0x1a);
  header.writeUInt16LE(0xfffe, 0x1c);
  header.writeUInt16LE(9, 0x1e);
  header.writeUInt16LE(6, 0x20);
  header.writeUInt32LE(fatSectors, 0x2c);
  header.writeUInt32LE(fatSectors, 0x30);
  header.writeUInt32LE(4096, 0x38);
  header.writeUInt32LE(0xfffffffe, 0x3c);
  header.writeUInt32LE(0xfffffffe, 0x44);
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
  const bodies = streams.map((s, i) => {
    const b = Buffer.alloc(counts[i]! * S);
    s.data.copy(b);
    return b;
  });
  return Buffer.concat([header, fatBuf, dir, ...bodies]);
}

/** Word 97 file whose piece table has the given CPs; every piece points at the same run of 'A'. */
function wordDoc(cps: number[]): Buffer {
  const word = Buffer.alloc(4096);
  word.writeUInt16LE(0xa5ec, 0);
  word.writeUInt16LE(0x0200, 0x0a); // 1Table
  word.writeUInt16LE(14, 32);
  word.writeUInt16LE(22, 62);
  word.writeUInt16LE(93, 152);
  word.fill(0x41, 1024, 4096);
  const pieces = cps.length - 1;
  const lcb = 12 * pieces + 4;
  const table = Buffer.alloc(Math.max(4096, 5 + lcb));
  table[0] = 0x02;
  table.writeUInt32LE(lcb, 1);
  cps.forEach((cp, i) => table.writeUInt32LE(cp, 5 + i * 4));
  for (let i = 0; i < pieces; i += 1) table.writeUInt32LE((0x40000000 | 2048) >>> 0, 5 + (pieces + 1) * 4 + i * 8 + 2);
  word.writeUInt32LE(0, 418);
  word.writeUInt32LE(5 + lcb, 422); // fcClx, lcbClx
  return compoundFile([{ name: 'WordDocument', data: word }, { name: '1Table', data: table }]);
}

/** Excel 97 workbook stream aus LABEL-Datensätzen mit je eigenem Inhalt. */
function xlsLabels(count: number): Buffer {
  const records: Buffer[] = [];
  for (let i = 0; i < count; i += 1) {
    const text = Buffer.from(`${10_000_000 + i}${'x'.repeat(192)}`, 'latin1');
    const payload = Buffer.alloc(6 + 2 + 1 + text.length);
    payload.writeUInt16LE(text.length, 6);
    text.copy(payload, 9);
    const header = Buffer.alloc(4);
    header.writeUInt16LE(0x0204, 0);
    header.writeUInt16LE(payload.length, 2);
    records.push(header, payload);
  }
  return compoundFile([{ name: 'Workbook', data: Buffer.concat(records) }]);
}

/**
 * Excel 97 workbook stream: SST mit `empty` leeren Einträgen, danach ein Eintrag
 * mit `tail`, verteilt auf CONTINUE-Datensätze; eine LABELSST-Zelle zeigt auf `tail`.
 */
function xlsEmptySharedStrings(empty: number, tail: string): Buffer {
  const record = (type: number, payload: Buffer) => {
    const header = Buffer.alloc(4);
    header.writeUInt16LE(type, 0);
    header.writeUInt16LE(payload.length, 2);
    return Buffer.concat([header, payload]);
  };
  const tailBytes = Buffer.from(tail, 'latin1');
  const tailEntry = Buffer.alloc(3 + tailBytes.length);
  tailEntry.writeUInt16LE(tailBytes.length, 0);
  tailBytes.copy(tailEntry, 3);
  const perRecord = 2_740; // 3 Byte je leerem Eintrag, unter 8 224 Byte je Datensatz
  const records: Buffer[] = [];
  const head = Buffer.alloc(8);
  head.writeUInt32LE(empty + 1, 0);
  head.writeUInt32LE(empty + 1, 4);
  records.push(record(0x00fc, head));
  for (let done = 0; done < empty; done += perRecord) {
    records.push(record(0x003c, Buffer.alloc(3 * Math.min(perRecord, empty - done))));
  }
  records.push(record(0x003c, tailEntry));
  const label = Buffer.alloc(10);
  label.writeUInt32LE(empty, 6);
  records.push(record(0x00fd, label));
  const data = Buffer.concat(records);
  // compoundFile legt keinen Mini-Stream an: mindestens 4096 Byte (Nullen = leere Datensätze).
  return compoundFile([{ name: 'Workbook', data: Buffer.concat([data, Buffer.alloc(Math.max(0, 4096 - data.length))]) }]);
}

describe('office attachment text', () => {
  test.each([
    ['xlsx', 'lieferant-ean.xlsx'],
    ['xls', 'lieferant-ean.xls'],
    ['ods', 'lieferant-ean.ods'],
  ] as const)('%s: every cell, numbers as stored (EAN not in exponent form)', (kind, file) => {
    const text = extract(kind, fixture(file));
    expect(text).toContain(EAN);
    expect(text).toContain('4012345678901');
    expect(text).toContain('Schraube M8 Edelstahl');
    expect(text).toContain('Mutter Müller-Größe');
    expect(text).not.toMatch(/E\+12/i);
  });

  test.each([
    ['doc', 'angebot.doc'],
    ['rtf', 'angebot.rtf'],
    ['odt', 'angebot.odt'],
  ] as const)('%s: document text with umlauts', (kind, file) => {
    const text = extract(kind, fixture(file));
    expect(text).toContain(`Angebot für EAN ${EAN}`);
    expect(text).toContain('Umlauten äöü ß');
  });

  test('xlsb: shared strings, real, RK and inline string cells', async () => {
    const record = (type: number, payload: Buffer) => {
      const head: number[] = [];
      for (let t = type; ; ) { const b = t & 0x7f; t >>= 7; head.push(t ? b | 0x80 : b); if (!t) break; }
      for (let s = payload.length; ; ) { const b = s & 0x7f; s >>= 7; head.push(s ? b | 0x80 : b); if (!s) break; }
      return Buffer.concat([Buffer.from(head), payload]);
    };
    const wide = (text: string) => {
      const count = Buffer.alloc(4);
      count.writeUInt32LE(text.length, 0);
      return Buffer.concat([count, Buffer.from(text, 'utf16le')]);
    };
    const cell = (col: number) => {
      const c = Buffer.alloc(8);
      c.writeUInt32LE(col, 0);
      return c;
    };
    const real = (value: number) => { const b = Buffer.alloc(8); b.writeDoubleLE(value, 0); return b; };
    const u32 = (value: number) => { const b = Buffer.alloc(4); b.writeInt32LE(value, 0); return b; };
    const shared = Buffer.concat([
      record(159, Buffer.alloc(8)),
      record(19, Buffer.concat([Buffer.from([0]), wide('Dichtung Ø 12')])),
      record(160, Buffer.alloc(0)),
    ]);
    const sheet = Buffer.concat([
      record(7, Buffer.concat([cell(0), u32(0)])),
      record(5, Buffer.concat([cell(1), real(Number(EAN))])),
      record(2, Buffer.concat([cell(2), u32((42 << 2) | 2)])),
      record(6, Buffer.concat([cell(3), wide('Artikel 77-B')])),
    ]);
    const zip = new JSZip();
    zip.file('xl/sharedStrings.bin', shared);
    zip.file('xl/worksheets/sheet1.bin', sheet);
    const text = extract('xlsb', await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
    expect(text.split('\n')).toEqual(['Dichtung Ø 12', EAN, '42', 'Artikel 77-B']);
  });

  test('pptx: slide and notes text', async () => {
    const zip = new JSZip();
    zip.file('ppt/slides/slide1.xml', '<p:sld><a:p><a:r><a:t>Produktneuheit &amp; Preis</a:t></a:r></a:p></p:sld>');
    zip.file('ppt/notesSlides/notesSlide1.xml', `<p:notes><a:p><a:r><a:t>EAN ${EAN}</a:t></a:r></a:p></p:notes>`);
    const text = extract('pptx', await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
    expect(text).toContain('Produktneuheit & Preis');
    expect(text).toContain(`EAN ${EAN}`);
  });

  test('repeated cell values are indexed once, so long price lists fit the cap', async () => {
    const rows = Array.from({ length: 500 }, (_, i) => `<row><c t="inlineStr"><is><t>Kategorie Schrauben</t></is></c><c><v>${4000000000000 + i}</v></c></row>`).join('');
    const zip = new JSZip();
    zip.file('xl/worksheets/sheet1.xml', `<worksheet><sheetData>${rows}</sheetData></worksheet>`);
    const text = extract('xlsx', await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
    expect(text.match(/Kategorie Schrauben/g)).toHaveLength(1);
    expect(text).toContain('4000000000499');
  });

  // .NET-Exporte (OpenXML SDK) schreiben Präfixe und teils andere Groß-/Kleinschreibung.
  test('xlsx: namespace prefixes, single quotes and differently cased part names', async () => {
    const zip = new JSZip();
    zip.file('xl/SharedStrings.xml', '<x:sst xmlns:x="urn:x"><x:si><x:t>Scheibe Ø 8</x:t></x:si></x:sst>');
    zip.file('xl/worksheets/Sheet1.xml', `<x:worksheet><x:sheetData><x:row><x:c r='A1' t='s'><x:v>0</x:v></x:c><x:c r='B1'><x:v>${EAN}</x:v></x:c></x:row></x:sheetData></x:worksheet>`);
    const text = extract('xlsx', await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
    expect(text.split('\n')).toEqual(['Scheibe Ø 8', EAN]);
  });

  test('xls: an encrypted workbook is refused instead of indexing noise', () => {
    const xls = Buffer.from(fixture('lieferant-ean.xls'));
    const bof = xls.indexOf(Buffer.from([0x09, 0x08, 0x10, 0x00, 0x00, 0x06, 0x05, 0x00]));
    expect(bof).toBeGreaterThan(0);
    xls.writeUInt16LE(0x002f, bof + 4 + 16); // record after BOF becomes FILEPASS
    expect(() => extract('xls', xls)).toThrow('xls is encrypted');
  });

  test('rtf: code page bytes, unicode escapes and skipped destinations', () => {
    const rtf = '{\\rtf1\\ansi\\ansicpg1252{\\fonttbl{\\f0 Arial;}}{\\*\\generator Test}Gr\\\'fc\\\'dfe \\u8364?\\par EAN 4006381333931}';
    expect(extractRtfText(Buffer.from(rtf, 'latin1'))).toBe('Grüße €\nEAN 4006381333931');
  });

  test('numbers in exponent form become all digits when they are integers', () => {
    expect(spreadsheetNumber('4.006381333931E+12')).toBe(EAN);
    expect(spreadsheetNumber('0.42')).toBe('0.42');
    expect(spreadsheetNumber('1.5E+300')).toBe('1.5E+300');
  });
});

describe('text attachments are decoded in their own charset', () => {
  const csv = `EAN;Artikel\n${EAN};Mutter Müller-Größe\n`;

  test.each([
    ['UTF-8', Buffer.from(csv, 'utf8')],
    ['UTF-8 with BOM', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(csv, 'utf8')])],
    ['UTF-16 LE with BOM (Excel "Unicode text")', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(csv, 'utf16le')])],
    ['UTF-16 LE without BOM', Buffer.from(csv, 'utf16le')],
    ['Windows-1252 (Excel CSV)', Buffer.from(csv, 'latin1')],
  ])('%s', (_label, data) => {
    expect(decodeAttachmentText(data)).toBe(csv);
  });

  test('file names that lie are corrected by the first bytes', () => {
    expect(refineAttachmentTextKind('xls', Buffer.from(`${EAN};Schraube`))).toBe('text');
    expect(refineAttachmentTextKind('xls', Buffer.from('<table><tr><td>1</td></tr></table>'))).toBe('html');
    expect(refineAttachmentTextKind('xls', Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe('xlsx');
    expect(refineAttachmentTextKind('doc', Buffer.from('{\\rtf1 Hallo}'))).toBe('rtf');
    expect(refineAttachmentTextKind('xls', fixture('lieferant-ean.xls'))).toBe('xls');
  });
});

// Anhänge kommen von außen: kaputte oder präparierte Dateien dürfen nur einen
// Fehler auslösen, nie hängen oder unbegrenzt Speicher belegen.
describe('damaged or crafted office files fail safely', () => {
  test('a zip that inflates beyond the budget is refused', () => {
    const huge = deflateRawSync(Buffer.alloc(70 * 1024 * 1024));
    const name = Buffer.from('xl/worksheets/sheet1.xml');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(huge.length, 18);
    local.writeUInt32LE(1000, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(huge.length, 20);
    central.writeUInt32LE(1000, 24);
    central.writeUInt16LE(name.length, 28);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(1, 8);
    end.writeUInt16LE(1, 10);
    end.writeUInt32LE(central.length + name.length, 12);
    end.writeUInt32LE(local.length + name.length + huge.length, 16);
    const zip = Buffer.concat([local, name, huge, central, name, end]);
    expect(() => extract('xlsx', zip)).toThrow();
  });

  // Muster wie `<c ...>[\s\S]*?</c>` laufen auf solchen Dateien quadratisch lange;
  // der Leser liest jedes Zeichen nur wenige Male.
  test('crafted XML without closing tags is read in linear time', async () => {
    const open = '<c t="s"><v>1'.repeat(40_000);
    const unclosed = '<t <t '.repeat(40_000);
    const zip = new JSZip();
    zip.file('xl/sharedStrings.xml', `<sst><si>${'<si>'.repeat(40_000)}${unclosed}`);
    zip.file('xl/worksheets/sheet1.xml', `<worksheet><sheetData>${open}${'<'.repeat(200_000)}`);
    const xlsx = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const ods = new JSZip();
    ods.file('content.xml', `<office:body>${'<table:table-cell office:value="1">'.repeat(40_000)}${'<'.repeat(200_000)}`);
    const odsFile = await ods.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

    const started = Date.now();
    expect(typeof extract('xlsx', xlsx)).toBe('string');
    expect(typeof extract('ods', odsFile)).toBe('string');
    expect(typeof extract('odt', odsFile)).toBe('string');
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  // Plan 039: DOC, XLS und RTF hören bei der doppelten Textobergrenze auf.
  test('doc: overlapping pieces stop at the output budget', () => {
    const file = wordDoc(Array.from({ length: 5001 }, (_, i) => i * 3072));
    const started = Date.now();
    expect(extract('doc', file).length).toBeLessThanOrEqual(OFFICE_TEXT_MAX_CHARS);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  test('doc: a piece table out of order is refused', () => {
    expect(() => extract('doc', wordDoc([0, 3072, 100]))).toThrow('doc piece table out of order');
  });

  test('xls: distinct values stop at the output budget', () => {
    expect(extract('xls', xlsLabels(6_000)).length).toBeLessThanOrEqual(OFFICE_TEXT_MAX_CHARS);
  });

  test('xls: leere Shared Strings zählen gegen das Budget (keine Millionen leerer Einträge)', () => {
    // Codex-Review zu Plan 039: leere SST-Einträge erhöhten die Zeichenzahl nie.
    expect(extract('xls', xlsEmptySharedStrings(10, 'Treffer'))).toContain('Treffer');
    const started = Date.now();
    expect(extract('xls', xlsEmptySharedStrings(OFFICE_TEXT_MAX_CHARS + 10, 'Treffer'))).not.toContain('Treffer');
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  test('rtf: plain text stops at the output budget', () => {
    const started = Date.now();
    expect(extractRtfText(Buffer.from(`{\\rtf1 ${'x'.repeat(3_000_000)}}`, 'latin1')).length)
      .toBeLessThanOrEqual(OFFICE_TEXT_MAX_CHARS);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  test('rtf: a multi-byte character across the flush boundary stays intact', () => {
    const text = extractRtfText(Buffer.concat([
      Buffer.from('{\\rtf1\\ansicpg65001 '),
      Buffer.from(`${'a'.repeat(65_535)}ä`, 'utf8'),
      Buffer.from('}'),
    ]));
    expect(text.endsWith('aä')).toBe(true);
    expect(text).toHaveLength(65_536);
  });

  test('rtf nested beyond any real document is refused', () => {
    expect(() => extractRtfText(Buffer.from(`{\\rtf1 ${'{'.repeat(200_000)}x`))).toThrow('rtf nested too deeply');
  });

  test('compound file with a bogus mini sector size is refused', () => {
    const xls = Buffer.from(fixture('lieferant-ean.xls'));
    xls.writeUInt16LE(31, 0x20);
    expect(() => extract('xls', xls)).toThrow('compound file mini sector size');
  });

  test.each([
    ['xls', 'lieferant-ean.xls'],
    ['doc', 'angebot.doc'],
    ['xlsx', 'lieferant-ean.xlsx'],
    ['ods', 'lieferant-ean.ods'],
    ['rtf', 'angebot.rtf'],
  ] as const)('%s: truncated and randomly damaged copies end quickly', (kind, file) => {
    const original = fixture(file);
    // RTF wird tolerant gelesen (abgeschnitten: der Text bis dahin).
    if (kind !== 'rtf') expect(() => extract(kind, original.subarray(0, 700))).toThrow();
    const started = Date.now();
    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    for (let round = 0; round < 150; round += 1) {
      const damaged = Buffer.from(original);
      for (let flips = 0; flips < 8; flips += 1) damaged[random() % damaged.length] = random() & 0xff;
      try {
        const text = extract(kind, damaged);
        expect(typeof text).toBe('string');
      } catch (error) {
        // zlib-Fehler kommen aus einem anderen Realm: kein instanceof.
        expect(typeof (error as { message?: unknown }).message).toBe('string');
      }
    }
    expect(Date.now() - started).toBeLessThan(20_000);
  });
});
