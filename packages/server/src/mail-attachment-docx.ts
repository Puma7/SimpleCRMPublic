/**
 * DOCX and PDF text extraction in a worker thread (C-A7, G7). The inflate
 * budget bounds the XML, not the DOM mammoth/xmldom builds from it: a DOCX of
 * a few dozen KB inside the budget reaches several GB of heap and blocks the
 * event loop for tens of seconds. A crafted PDF can do the same to pdf.js,
 * and a PDF parse in the main thread could not even be stopped after its
 * timeout. Both parsers therefore run in a worker with its own heap limit;
 * on out-of-memory or timeout only the worker is gone (terminated) and the
 * attachment stays without text. Attachments are only parsed for their text,
 * never opened or executed.
 *
 * This module is also the worker entry: the worker loads this same file
 * (dist/mail-attachment-docx.js in the build, the .ts source under Jest/tsx).
 */
import { createRequire } from 'node:module';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';

import { inflateRawSync } from 'node:zlib';

import {
  assertDocxInflatesWithinLimit,
  capAttachmentText,
  extractOfficeText,
  type DocxZipLoader,
  type OfficeTextKind,
} from '@simplecrm/core';

const DOCX_WORKER_RESOURCE_LIMITS = {
  maxOldGenerationSizeMb: 512,
  maxYoungGenerationSizeMb: 32,
  stackSizeMb: 4,
} as const;

const MIB = 1024 * 1024;
const HEAP_POLL_INTERVAL_MS = 100;
const WORKER_KIND = 'simplecrm-docx-text';

type TextWorkerFormat = 'docx' | 'pdf' | OfficeTextKind;
type DocxWorkerInput = { kind: typeof WORKER_KIND; format?: TextWorkerFormat; docx: Uint8Array };
type DocxWorkerResult = { text: string } | { error: string };

/** JSZip resolved from mammoth's own location, i.e. the parser mammoth reads the DOCX with. */
function mammothJsZip(): DocxZipLoader {
  return createRequire(require.resolve('mammoth'))('jszip') as DocxZipLoader;
}

/**
 * Inflate guard, then mammoth, in the calling thread: the former in-process
 * path. Runs inside the worker; tests compare the worker's text against it.
 */
export async function extractDocxText(buf: Buffer): Promise<string> {
  await assertDocxInflatesWithinLimit(buf, mammothJsZip());
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ buffer: buf });
  return capAttachmentText(result.value ?? '');
}

/** pdf.js in the calling thread; runs inside the worker. */
export async function extractPdfText(buf: Buffer): Promise<string> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    const result = await parser.getText();
    return capAttachmentText(result.text ?? '');
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

/** Spreadsheets, RTF, DOC, OpenDocument, PPTX (core readers); runs inside the worker. */
export function extractOfficeTextInThread(kind: OfficeTextKind, buf: Buffer): string {
  return capAttachmentText(extractOfficeText(kind, buf, (data, maxOutputLength) => inflateRawSync(data, { maxOutputLength })));
}

/** Built code starts this compiled module; from TS sources (Jest, tsx) the worker needs the tsx loader too. */
function workerEntry(): { filename: string; execArgv?: string[] } {
  return __filename.endsWith('.ts')
    ? { filename: __filename, execArgv: ['--import', 'tsx'] }
    : { filename: __filename };
}

/**
 * A process-wide --max-old-space-size (e.g. from NODE_OPTIONS) replaces the
 * worker's resourceLimits. Only then does the parent enforce the budget
 * itself; otherwise V8 stops the worker, and the parent stays out of it
 * because a terminate() right at the V8 limit can abort Electron.
 */
function heapLimitOverridden(heapSizeLimit: number): boolean {
  return heapSizeLimit > 2 * DOCX_WORKER_RESOURCE_LIMITS.maxOldGenerationSizeMb * MIB;
}

/**
 * DOCX -> plain text in a worker with a heap limit; terminated after
 * timeoutMs. Rejects on parse errors, out-of-memory and timeout.
 */
export function extractDocxTextInWorker(buf: Buffer, timeoutMs: number): Promise<string> {
  return runTextWorker('docx', buf, timeoutMs);
}

/** PDF -> plain text in the same kind of worker (heap limit, terminated after timeoutMs). */
export function extractPdfTextInWorker(buf: Buffer, timeoutMs: number): Promise<string> {
  return runTextWorker('pdf', buf, timeoutMs);
}

/** Office formats (xlsx, xlsb, xls, ods, odt, rtf, doc, pptx) in the same kind of worker. */
export function extractOfficeTextInWorker(kind: OfficeTextKind, buf: Buffer, timeoutMs: number): Promise<string> {
  return runTextWorker(kind, buf, timeoutMs);
}

function runTextWorker(format: TextWorkerFormat, buf: Buffer, timeoutMs: number): Promise<string> {
  const label = format.toUpperCase();
  const entry = workerEntry();
  const worker = new Worker(entry.filename, {
    execArgv: entry.execArgv,
    // Explicitly the caller's process.env (the default outside Jest): under Jest the
    // test's sandboxed env (e.g. TSX_TSCONFIG_PATH) must reach the tsx-loaded worker.
    env: process.env,
    workerData: { kind: WORKER_KIND, format, docx: buf } satisfies DocxWorkerInput,
    resourceLimits: DOCX_WORKER_RESOURCE_LIMITS,
  });
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let heapTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error: Error | null, text = '') => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      clearTimeout(heapTimer);
      void worker.terminate();
      if (error) reject(error);
      else resolve(text);
    };
    const stop = (reason: string) => {
      const error = new Error(`${label} parse stopped: ${reason}`);
      console.warn(`[mail] attachment text: ${error.message}; attachment stays without text`);
      finish(error);
    };
    const heapLimit = `heap limit ${DOCX_WORKER_RESOURCE_LIMITS.maxOldGenerationSizeMb} MB`;
    const deadline = setTimeout(() => stop(`timeout after ${timeoutMs} ms`), timeoutMs);
    const watchHeap = () => {
      heapTimer = setTimeout(() => {
        worker.getHeapStatistics().then(
          (stats) => {
            if (settled) return;
            if (
              heapLimitOverridden(stats.heap_size_limit)
              && stats.used_heap_size > DOCX_WORKER_RESOURCE_LIMITS.maxOldGenerationSizeMb * MIB
            ) {
              stop(heapLimit);
            } else {
              watchHeap();
            }
          },
          () => undefined,
        );
      }, HEAP_POLL_INTERVAL_MS);
    };
    worker.on('message', (result: DocxWorkerResult) => {
      if ('text' in result) finish(null, result.text);
      else finish(new Error(result.error));
    });
    worker.on('error', (error: Error & { code?: string }) => {
      if (error.code === 'ERR_WORKER_OUT_OF_MEMORY') {
        stop(heapLimit);
        return;
      }
      console.warn(`[mail] attachment text: ${label} worker failed: ${error.message}`);
      finish(error);
    });
    worker.on('exit', (code) => finish(new Error(`${label} worker exited with code ${code}`)));
    watchHeap();
  });
}

if (!isMainThread && (workerData as Partial<DocxWorkerInput> | null)?.kind === WORKER_KIND) {
  const { docx, format } = workerData as DocxWorkerInput;
  const input = Buffer.from(docx.buffer, docx.byteOffset, docx.byteLength);
  const run = format === 'pdf'
    ? extractPdfText(input)
    : format === 'docx' || format === undefined
      ? extractDocxText(input)
      : Promise.resolve().then(() => extractOfficeTextInThread(format, input));
  run.then(
    (text) => parentPort?.postMessage({ text } satisfies DocxWorkerResult),
    (error: unknown) =>
      parentPort?.postMessage({
        error: error instanceof Error ? error.message : String(error),
      } satisfies DocxWorkerResult),
  );
}
