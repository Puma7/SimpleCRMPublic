/**
 * @jest-environment node
 *
 * DOCX text extraction must not take the process down: a DOCX that stays
 * inside the inflate budget can still blow mammoth/xmldom up to gigabytes.
 * The isolation tests run the production extractors of both editions in a
 * fresh Node process (tsx, like the PDF runtime test), so peak RSS and
 * survival of that process are measured without Jest's own heap in the
 * numbers. The desktop worker tests below run in-process.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { deflateRawSync } from 'node:zlib';

import JSZip from 'jszip';

import { extractDocxText, extractDocxTextInWorker } from '../../electron/email/attachment-text-docx';
import { extractAttachmentTextFromBuffer } from '../../electron/email/attachment-text-extract';

const ROOT = path.resolve(__dirname, '../..');
const EXTRACTORS = {
  desktop: path.join(ROOT, 'electron/email/attachment-text-extract.ts'),
  server: path.join(ROOT, 'packages/server/src/mail-attachment-text.ts'),
} as const;

/** ZIP with DEFLATE entries from node:zlib (JSZip's JS deflate is too slow for 30 MiB). */
function buildDeflatedZip(files: Array<[string, Buffer]>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBytes = Buffer.from(name);
    const compressed = deflateRawSync(data, { level: 9 });
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    localParts.push(local, nameBytes, compressed);
    centralParts.push(central, nameBytes);
    offset += local.length + nameBytes.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

/** Small DOCX whose document.xml (just under the 32 MiB inflate budget) is millions of empty paragraphs. */
function buildDomBombDocx(xmlMiB = 30): Buffer {
  const head =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>';
  const tail = '</w:body></w:document>';
  const paragraphs = Math.floor((xmlMiB * 1024 * 1024 - head.length - tail.length) / '<w:p/>'.length);
  return buildDeflatedZip([
    [
      '[Content_Types].xml',
      Buffer.from(
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
    ],
    [
      '_rels/.rels',
      Buffer.from(
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ),
    ],
    ['word/document.xml', Buffer.from(head + '<w:p/>'.repeat(paragraphs) + tail)],
  ]);
}

/** Kill switch far above the expected peak: a regression must fail the test, not exhaust the host. */
const RSS_KILL_BYTES = 3 * 1024 * 1024 * 1024;

const CHILD_SCRIPT = `
  import { readFileSync } from 'node:fs';
  import { Worker } from 'node:worker_threads';
  new Worker(
    "const { workerData } = require('node:worker_threads');"
      + "setInterval(() => { if (process.memoryUsage.rss() > workerData) process.kill(process.pid, 'SIGKILL'); }, 25);",
    { eval: true, execArgv: [], workerData: ${RSS_KILL_BYTES} },
  ).unref();
  const { extractAttachmentTextFromBuffer } = await import(process.env.EXTRACTOR_URL);
  const input = readFileSync(0);
  let peakRss = 0;
  let maxLagMs = 0;
  let last = performance.now();
  const sampler = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage.rss());
    const now = performance.now();
    maxLagMs = Math.max(maxLagMs, now - last - 20);
    last = now;
  }, 20);
  let outcome;
  try {
    outcome = { text: await extractAttachmentTextFromBuffer(input, 'docx') };
  } catch (error) {
    outcome = { error: error.message };
  }
  clearInterval(sampler);
  process.stdout.write(JSON.stringify({
    ...outcome,
    peakRssMb: Math.round(peakRss / 2 ** 20),
    maxLagMs: Math.round(maxLagMs),
  }));
`;

type ChildResult = { text?: string; error?: string; peakRssMb: number; maxLagMs: number };

function extractInFreshProcess(extractor: string, input: Buffer, nodeOptions: string) {
  return spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', CHILD_SCRIPT], {
    cwd: ROOT,
    env: {
      ...process.env,
      EXTRACTOR_URL: pathToFileURL(extractor).href,
      NODE_OPTIONS: nodeOptions,
      // Match Jest's source aliases; a fresh checkout has no core/dist yet.
      TSX_TSCONFIG_PATH: path.resolve(__dirname, '../setup/tsconfig.node-runtime.json'),
    },
    input,
    encoding: 'utf8',
    timeout: 120_000,
    windowsHide: true,
  });
}

describe('DOCX extraction runs isolated from the process', () => {
  const domBomb = buildDomBombDocx();

  test('the probe DOCX is small and inside the inflate budget', () => {
    expect(domBomb.length).toBeLessThan(256 * 1024);
  });

  // C-A7: Eine kleine DOCX im Entpack-Budget trieb mammoth im Hauptprozess auf mehrere GB RSS (bei begrenztem
  // Heap Absturz mit Exit 134); die Extraktion laeuft jetzt in einem Worker mit Heap-Limit, der beendet wird.
  // With a process-wide --max-old-space-size the worker's own limit is that value; the parent
  // stops it at 512 MB used heap as well, but that poll can lag on a loaded host, hence the wider bound.
  test.each([
    ['desktop', 'worker heap limit', '', 1536],
    ['server', 'worker heap limit', '', 1536],
    ['desktop', 'process-wide --max-old-space-size', '--max-old-space-size=1536', 2560],
    ['server', 'process-wide --max-old-space-size', '--max-old-space-size=1536', 2560],
  ] as const)('%s: DOM bomb DOCX ends without text, process survives (%s)', (edition, _label, nodeOptions, maxRssMb) => {
    const child = extractInFreshProcess(EXTRACTORS[edition], domBomb, nodeOptions);

    expect({ status: child.status, signal: child.signal, stderr: child.status === 0 ? '' : child.stderr }).toEqual({
      status: 0,
      signal: null,
      stderr: '',
    });
    const result = JSON.parse(child.stdout) as ChildResult;
    expect(result.text).toBeUndefined();
    expect(result.error).toMatch(/DOCX parse stopped: heap limit/);
    expect(result.peakRssMb).toBeLessThan(maxRssMb);
    // The parse no longer blocks the event loop (before: up to 18 s at a stretch).
    expect(result.maxLagMs).toBeLessThan(5_000);
    expect(child.stderr).toMatch(/DOCX parse stopped: heap limit/);
  }, 150_000);
});

async function buildDocx(bodyXml: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyXml}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

const MIB = 1024 * 1024;

describe('desktop DOCX worker', () => {
  test('ordinary DOCX give the worker the same text as the former in-process parse', async () => {
    const bodies = [
      '<w:p><w:r><w:t>Suchtext DOCX Inhalt</w:t></w:r></w:p>',
      '<w:p><w:r><w:t>Angebot für Müller &amp; Söhne</w:t></w:r></w:p>'
        + '<w:p><w:r><w:t xml:space="preserve">Position 1</w:t><w:tab/><w:t>12,50 €</w:t><w:br/><w:t>Zeile 2</w:t></w:r></w:p>'
        + '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Zelle A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Zelle B</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
      `<w:p><w:r><w:t>${'Rechnung '.repeat(80_000)}Ende</w:t></w:r></w:p>`,
    ];
    for (const body of bodies) {
      const docx = await buildDocx(body);
      const inProcess = await extractDocxText(docx);
      expect(inProcess.length).toBeGreaterThan(0);
      await expect(extractAttachmentTextFromBuffer(docx, 'docx')).resolves.toBe(inProcess);
    }
    await expect(extractAttachmentTextFromBuffer(await buildDocx(bodies[1]!), 'docx')).resolves.toBe(
      'Angebot für Müller & Söhne Position 1 12,50 €Zeile 2 Zelle A Zelle B',
    );
  }, 60_000);

  test('parse errors from the worker keep their message', async () => {
    await expect(extractDocxTextInWorker(Buffer.from('kein zip'), 30_000)).rejects.toThrow(/zip/i);
  }, 30_000);

  // C-A7: Das Parse-Timeout lehnte nur das Promise ab; mammoth rechnete im Hauptprozess weiter. Jetzt wird der Worker beendet.
  test('terminates the parse worker when the timeout expires', async () => {
    const terminate = jest.spyOn(Worker.prototype, 'terminate');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(extractDocxTextInWorker(buildDomBombDocx(), 300)).rejects.toThrow(
      'DOCX parse stopped: timeout after 300 ms',
    );
    expect(terminate).toHaveBeenCalled();
    await expect(terminate.mock.results[0]!.value).resolves.toEqual(expect.any(Number));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[email] attachment text: DOCX parse stopped: timeout'));
  }, 30_000);

  // C-A7: Ein prozessweites --max-old-space-size (NODE_OPTIONS) hebt resourceLimits auf; dann beendet der Elternprozess den Worker.
  test('stops the worker itself when a process-wide heap flag overrides its limit', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const terminate = jest.spyOn(Worker.prototype, 'terminate');
    jest
      .spyOn(Worker.prototype, 'getHeapStatistics')
      .mockResolvedValue({ heap_size_limit: 4096 * MIB, used_heap_size: 600 * MIB } as Awaited<
        ReturnType<Worker['getHeapStatistics']>
      >);

    await expect(extractDocxTextInWorker(buildDomBombDocx(), 30_000)).rejects.toThrow(
      'DOCX parse stopped: heap limit 512 MB',
    );
    expect(terminate).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('DOCX parse stopped: heap limit 512 MB'));
  }, 30_000);

  test('leaves the stop to V8 while the worker heap limit is in effect', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const stats = jest
      .spyOn(Worker.prototype, 'getHeapStatistics')
      .mockResolvedValue({ heap_size_limit: 560 * MIB, used_heap_size: 540 * MIB } as Awaited<
        ReturnType<Worker['getHeapStatistics']>
      >);

    await expect(extractDocxTextInWorker(buildDomBombDocx(), 500)).rejects.toThrow(
      'DOCX parse stopped: timeout after 500 ms',
    );
    expect(stats).toHaveBeenCalled();
  }, 30_000);
});
