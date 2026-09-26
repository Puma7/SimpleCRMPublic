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
