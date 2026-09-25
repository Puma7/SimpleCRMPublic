/**
 * DOCX text extraction in a worker thread (C-A7, G7). The inflate budget
 * bounds the XML, not the DOM mammoth/xmldom builds from it: a DOCX of a few
 * dozen KB inside the budget reaches several GB of heap and blocks the event
 * loop for tens of seconds. Guard and parse therefore run in a worker with
 * its own heap limit; on out-of-memory or timeout only the worker is gone and
 * the attachment stays without text.
 *
 * This module is also the worker entry: the worker loads this same file
 * (dist-electron/electron/email/attachment-text-docx.js in the build, also
 * from inside app.asar; the .ts source under Jest/tsx).
 */
import { createRequire } from 'module';
import { isMainThread, parentPort, Worker, workerData } from 'worker_threads';
// Straight from the core module, not via email-parse-utils: the worker loads only what it needs.
import {
  assertDocxInflatesWithinLimit,
  capAttachmentText,
  type DocxZipLoader,
} from '../../packages/core/src/email/attachment-text';

const DOCX_WORKER_RESOURCE_LIMITS = {
  maxOldGenerationSizeMb: 512,
  maxYoungGenerationSizeMb: 32,
  stackSizeMb: 4,
} as const;

const MIB = 1024 * 1024;
const HEAP_POLL_INTERVAL_MS = 100;
const WORKER_KIND = 'simplecrm-docx-text';

type DocxWorkerInput = { kind: typeof WORKER_KIND; docx: Uint8Array };
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
  const entry = workerEntry();
  const worker = new Worker(entry.filename, {
    execArgv: entry.execArgv,
    workerData: { kind: WORKER_KIND, docx: buf } satisfies DocxWorkerInput,
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
      const error = new Error(`DOCX parse stopped: ${reason}`);
      console.warn(`[email] attachment text: ${error.message}; attachment stays without text`);
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
      console.warn(`[email] attachment text: DOCX worker failed: ${error.message}`);
      finish(error);
    });
    worker.on('exit', (code) => finish(new Error(`DOCX worker exited with code ${code}`)));
    watchHeap();
  });
}

if (!isMainThread && (workerData as Partial<DocxWorkerInput> | null)?.kind === WORKER_KIND) {
  const { docx } = workerData as DocxWorkerInput;
  extractDocxText(Buffer.from(docx.buffer, docx.byteOffset, docx.byteLength)).then(
    (text) => parentPort?.postMessage({ text } satisfies DocxWorkerResult),
    (error: unknown) =>
      parentPort?.postMessage({
        error: error instanceof Error ? error.message : String(error),
      } satisfies DocxWorkerResult),
  );
}
