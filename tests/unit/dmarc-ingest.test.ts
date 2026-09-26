/**
 * @jest-environment node
 */
import { basename } from 'node:path';
import { gzipSync } from 'node:zlib';

import {
  createPostgresWorkflowDmarcIngestPort,
  type WorkflowDmarcIngestJobPlan,
} from '../../packages/server/src/dmarc-ingest';
import type { DmarcStorePort } from '../../packages/server/src/db/postgres-dmarc-port';
import {
  MAX_DECOMPRESSED_BYTES,
  MAX_DMARC_RECORDS_PER_REPORT,
  parseDmarcXml,
  summarizeDmarcRecords,
} from '../../packages/server/src/dmarc/parse-aggregate-report';

const WS = '11111111-1111-4111-8111-111111111111';

// One aligned-pass row + one both-fail (unauthorized) row.
const REPORT_XML = `<feedback>
  <report_metadata><org_name>google.com</org_name><report_id>G-1</report_id>
    <date_range><begin>1720396800</begin><end>1720483199</end></date_range></report_metadata>
  <policy_published><domain>firma.de</domain><p>reject</p></policy_published>
  <record><row><source_ip>209.85.220.41</source_ip><count>7</count>
    <policy_evaluated><disposition>none</disposition><dkim>pass</dkim><spf>pass</spf></policy_evaluated></row>
    <identifiers><header_from>firma.de</header_from></identifiers></record>
  <record><row><source_ip>45.83.12.9</source_ip><count>3</count>
    <policy_evaluated><disposition>reject</disposition><dkim>fail</dkim><spf>fail</spf></policy_evaluated></row>
    <identifiers><header_from>firma.de</header_from></identifiers></record>
</feedback>`;

type JobInsert = { table: string; values: Record<string, unknown> };

/** Minimal fake Kysely: serves the ingest port's attachment SELECT and captures
 *  its job_queue INSERT. `selectThrows` simulates a DB read failure. */
function makeFakeDb(opts: {
  attachments: Array<{ filename_display: string; storage_path: string }>;
  jobInserts: JobInsert[];
  selectThrows?: boolean;
}) {
  const trx = {
    selectFrom: (_table: string) => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.where = () => b;
      b.execute = async () => {
        if (opts.selectThrows) throw new Error('db read failed');
        return opts.attachments;
      };
      return b;
    },
    insertInto: (table: string) => {
      const b: Record<string, unknown> = {};
      b.values = (values: Record<string, unknown>) => {
        opts.jobInserts.push({ table, values });
        return b;
      };
      b.execute = async () => [];
      return b;
    },
  };
  return {
    transaction: () => ({ execute: async (cb: (t: typeof trx) => Promise<unknown>) => cb(trx) }),
  } as never;
}

function makeStore(overrides: Partial<DmarcStorePort> = {}): DmarcStorePort {
  return {
    persistReport: jest.fn(async () => ({
      reportRowId: 'r1',
      isNew: true,
      summary: {
        recordCount: 0, messageCount: 0, passCount: 0, failCount: 0,
        rejectCount: 0, quarantineCount: 0, unauthorizedSourceCount: 0, topSourceIp: null,
      },
    })),
    ...overrides,
  };
}

const CONTINUATION: WorkflowDmarcIngestJobPlan['continuation'] = {
  workflowId: 5,
  triggerName: 'inbound',
  resumeNodeId: 'threshold-1',
};

function eventVars(insert: JobInsert): Record<string, unknown> {
  const payload = insert.values.payload as { context?: { eventVariables?: Record<string, unknown> } };
  return payload.context?.eventVariables ?? {};
}

/** A report with its own id and the given `<record>` rows. */
function reportXml(reportId: string, records: string): string {
  const header = REPORT_XML.slice(0, REPORT_XML.indexOf('<record>')).replace('G-1', reportId);
  return `${header}${records}</feedback>`;
}

function recordXml(sourceIp: string, count: number, disposition: string, dkim: string, spf: string): string {
  const ip = sourceIp ? `<source_ip>${sourceIp}</source_ip>` : '';
  return `<record><row>${ip}<count>${count}</count><policy_evaluated><disposition>${disposition}</disposition>`
    + `<dkim>${dkim}</dkim><spf>${spf}</spf></policy_evaluated></row></record>`;
}

/** Ingest port over in-memory attachment files (name -> bytes). */
function portForFiles(
  files: Record<string, Buffer>,
  jobInserts: JobInsert[],
  store: DmarcStorePort,
  readAttachmentFile: (path: string) => Promise<Buffer> = async (file) => files[basename(file)]!,
) {
  return createPostgresWorkflowDmarcIngestPort({
    db: makeFakeDb({
      attachments: Object.keys(files).map((name) => ({ filename_display: name, storage_path: name })),
      jobInserts,
    }),
    attachmentsRoot: '/tmp/att',
    readAttachmentFile,
    store,
    applyWorkspaceSession: async () => undefined,
  });
}

function persistedReportIds(store: DmarcStorePort): string[] {
  return (store.persistReport as jest.Mock).mock.calls
    .map(([input]) => (input as { report: { reportId: string } }).report.reportId);
}

describe('createPostgresWorkflowDmarcIngestPort', () => {
  test('happy path: parses + persists and enqueues the continuation with dmarc.* vars', async () => {
    const jobInserts: JobInsert[] = [];
    const store = makeStore();
    const port = createPostgresWorkflowDmarcIngestPort({
      db: makeFakeDb({ attachments: [{ filename_display: 'report.xml', storage_path: 'report.xml' }], jobInserts }),
      attachmentsRoot: '/tmp/att',
      readAttachmentFile: async () => Buffer.from(REPORT_XML, 'utf8'),
      store,
      applyWorkspaceSession: async () => undefined,
    });

    await port.ingest({ workspaceId: WS, workflowId: 5, messageId: 40, continuation: CONTINUATION });

    expect(store.persistReport).toHaveBeenCalledTimes(1);
    const jobs = jobInserts.filter((j) => j.table === 'job_queue');
    expect(jobs).toHaveLength(1);
    const vars = eventVars(jobs[0]);
    expect(vars['dmarc.ok']).toBe(true);
    expect(vars['dmarc.report_count']).toBe(1);
    expect(vars['dmarc.fail_count']).toBe(3);
    expect(vars['dmarc.unauthorized_source_count']).toBe(1);
    expect(vars['dmarc.domain']).toBe('firma.de');
  });

  // F-A3b-03: spreading a report with more than ~125k records into push() threw a RangeError after the
  // report was already persisted, so it was logged as "skipped" and its records never reached dmarc.* vars.
  // Seit E13 (F-A3b-01) sind hoechstens MAX_DMARC_RECORDS_PER_REPORT Records je Report erlaubt; gezaehlt
  // wird deshalb der groesste zulaessige Report.
  test('counts every record of a very large report without a RangeError', async () => {
    const recordCount = MAX_DMARC_RECORDS_PER_REPORT;
    const header = REPORT_XML.slice(0, REPORT_XML.indexOf('<record>'));
    const record = '<record><row><count>1</count></row></record>';
    const xml = `${header}${record.repeat(recordCount)}</feedback>`;
    const jobInserts: JobInsert[] = [];
    const store = makeStore();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const port = createPostgresWorkflowDmarcIngestPort({
        db: makeFakeDb({ attachments: [{ filename_display: 'big.xml', storage_path: 'big.xml' }], jobInserts }),
        attachmentsRoot: '/tmp/att',
        readAttachmentFile: async () => Buffer.from(xml, 'utf8'),
        store,
        applyWorkspaceSession: async () => undefined,
      });

      await port.ingest({ workspaceId: WS, workflowId: 5, messageId: 41, continuation: CONTINUATION });

      expect(store.persistReport).toHaveBeenCalledTimes(1);
      const jobs = jobInserts.filter((j) => j.table === 'job_queue');
      expect(jobs).toHaveLength(1);
      expect(eventVars(jobs[0])['dmarc.report_count']).toBe(1);
      expect(eventVars(jobs[0])['dmarc.record_count']).toBe(recordCount);
      expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('skipping report attachment'));
    } finally {
      warn.mockRestore();
    }
  });

  // F-A3b-01: Ein einzelner Report mit bis zu 450.000 Records wurde vollstaendig geparst (rund 7,8 s synchron) und eingefuegt.
  test('skips and logs a report with more than MAX_DMARC_RECORDS_PER_REPORT records, the rest still ingests (E13)', async () => {
    const header = REPORT_XML.slice(0, REPORT_XML.indexOf('<record>'));
    const record = '<record><row><count>1</count></row></record>';
    const oversized = `${header.replace('G-1', 'G-BIG')}${record.repeat(MAX_DMARC_RECORDS_PER_REPORT + 1)}</feedback>`;
    const jobInserts: JobInsert[] = [];
    const store = makeStore();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const port = createPostgresWorkflowDmarcIngestPort({
        db: makeFakeDb({
          attachments: [
            { filename_display: 'huge.xml.gz', storage_path: 'huge.xml.gz' },
            { filename_display: 'report.xml', storage_path: 'report.xml' },
          ],
          jobInserts,
        }),
        attachmentsRoot: '/tmp/att',
        readAttachmentFile: async (path) => (basename(path) === 'huge.xml.gz'
          ? gzipSync(Buffer.from(oversized, 'utf8'))
          : Buffer.from(REPORT_XML, 'utf8')),
        store,
        applyWorkspaceSession: async () => undefined,
      });

      const started = Date.now();
      await port.ingest({ workspaceId: WS, workflowId: 5, messageId: 43, continuation: CONTINUATION });
      expect(Date.now() - started).toBeLessThan(1_500);

      expect(store.persistReport).toHaveBeenCalledTimes(1);
      expect((store.persistReport as jest.Mock).mock.calls[0][0].report.reportId).toBe('G-1');
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/huge\.xml\.gz.*100001.*100000/));
      const vars = eventVars(jobInserts.filter((j) => j.table === 'job_queue')[0]);
      expect(vars['dmarc.report_count']).toBe(1);
      expect(vars['dmarc.record_count']).toBe(2);
    } finally {
      warn.mockRestore();
    }
  });

  test('a report whose persist throws is skipped, others still ingest, continuation still enqueued', async () => {
    const jobInserts: JobInsert[] = [];
    let call = 0;
    const store = makeStore({
      persistReport: jest.fn(async () => {
        call += 1;
        if (call === 1) throw new Error('constraint violation');
        return {
          reportRowId: 'r2', isNew: true,
          summary: {
            recordCount: 0, messageCount: 0, passCount: 0, failCount: 0,
            rejectCount: 0, quarantineCount: 0, unauthorizedSourceCount: 0, topSourceIp: null,
          },
        };
      }),
    });
    const port = createPostgresWorkflowDmarcIngestPort({
      db: makeFakeDb({
        attachments: [
          { filename_display: 'a.xml', storage_path: 'a.xml' },
          { filename_display: 'b.xml', storage_path: 'b.xml' },
        ],
        jobInserts,
      }),
      attachmentsRoot: '/tmp/att',
      readAttachmentFile: async () => Buffer.from(REPORT_XML, 'utf8'),
      store,
      applyWorkspaceSession: async () => undefined,
    });

    await port.ingest({ workspaceId: WS, workflowId: 5, messageId: 41, continuation: CONTINUATION });

    expect(store.persistReport).toHaveBeenCalledTimes(2);
    const jobs = jobInserts.filter((j) => j.table === 'job_queue');
    expect(jobs).toHaveLength(1); // continuation enqueued despite the first failure
    expect(eventVars(jobs[0])['dmarc.report_count']).toBe(1); // only the second report counted
  });

  // F-A3b-01: Das Dekompressionslimit galt nur je Anhang; viele gzip-Anhaenge einer fremden Mail vervielfachten Parse-Zeit, Speicher und DB-Zeilen.
  test('stops ingesting once the decompressed reports of one message exceed the per-message budget', async () => {
    const jobInserts: JobInsert[] = [];
    const store = makeStore();
    // Each report decompresses to ~40 % of the per-attachment cap: two fit into
    // one message's budget, the third does not.
    const padding = 'x'.repeat(Math.floor(MAX_DECOMPRESSED_BYTES * 0.4));
    const gzReport = (reportId: string) => gzipSync(Buffer.from(
      REPORT_XML
        .replace('<report_id>G-1</report_id>', `<report_id>${reportId}</report_id>`)
        .replace('</feedback>', `<!-- ${padding} --></feedback>`),
      'utf8',
    ));
    const files: Record<string, Buffer> = {
      'a.xml.gz': gzReport('A'),
      'b.xml.gz': gzReport('B'),
      'c.xml.gz': gzReport('C'),
    };
    const port = createPostgresWorkflowDmarcIngestPort({
      db: makeFakeDb({
        attachments: Object.keys(files).map((name) => ({ filename_display: name, storage_path: name })),
        jobInserts,
      }),
      attachmentsRoot: '/tmp/att',
      readAttachmentFile: async (file) => files[basename(file)]!,
      store,
      applyWorkspaceSession: async () => undefined,
    });

    await port.ingest({ workspaceId: WS, workflowId: 5, messageId: 44, continuation: CONTINUATION });

    const persistedIds = (store.persistReport as jest.Mock).mock.calls
      .map(([input]) => (input as { report: { reportId: string } }).report.reportId);
    expect(persistedIds).toEqual(['A', 'B']);
    const jobs = jobInserts.filter((j) => j.table === 'job_queue');
    expect(jobs).toHaveLength(1);
    expect(eventVars(jobs[0])['dmarc.report_count']).toBe(2);
  });

  test('catastrophic failure (attachment read query throws) still enqueues the continuation, no rethrow', async () => {
    const jobInserts: JobInsert[] = [];
    const port = createPostgresWorkflowDmarcIngestPort({
      db: makeFakeDb({ attachments: [], jobInserts, selectThrows: true }),
      attachmentsRoot: '/tmp/att',
      readAttachmentFile: async () => Buffer.from(REPORT_XML, 'utf8'),
      store: makeStore(),
      applyWorkspaceSession: async () => undefined,
    });

    await expect(
      port.ingest({ workspaceId: WS, workflowId: 5, messageId: 42, continuation: CONTINUATION }),
    ).resolves.toBeUndefined();

    const jobs = jobInserts.filter((j) => j.table === 'job_queue');
    expect(jobs).toHaveLength(1);
    expect(eventVars(jobs[0])['dmarc.ok']).toBe(false);
    expect(eventVars(jobs[0])['dmarc.report_count']).toBe(0);
  });

  test('catastrophic failure WITHOUT a continuation surfaces the error to the job queue', async () => {
    const jobInserts: JobInsert[] = [];
    const port = createPostgresWorkflowDmarcIngestPort({
      db: makeFakeDb({ attachments: [], jobInserts, selectThrows: true }),
      attachmentsRoot: '/tmp/att',
      readAttachmentFile: async () => Buffer.from(REPORT_XML, 'utf8'),
      store: makeStore(),
      applyWorkspaceSession: async () => undefined,
    });

    await expect(
      port.ingest({ workspaceId: WS, workflowId: 5, messageId: 43 }),
    ).rejects.toThrow('db read failed');
    expect(jobInserts.filter((j) => j.table === 'job_queue')).toHaveLength(0);
  });
});

// C-A73: Die Budgets galten nur je Report bzw. nur fuer gelungene Dekompressionen; eine fremde Mail
// konnte mit vielen Anhaengen beliebig viele Entpackversuche, Reports und Records ausloesen.
describe('DMARC ingest budget per message', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  test('failed decompressions use up the per-message budget instead of being free', async () => {
    const bomb = gzipSync(Buffer.alloc(MAX_DECOMPRESSED_BYTES + 1, 0x20), { level: 9 });
    const files: Record<string, Buffer> = {};
    for (let index = 0; index < 30; index += 1) files[`bomb-${index}.xml.gz`] = bomb;
    const readAttachmentFile = jest.fn(async (file: string) => files[basename(file)]!);
    const jobInserts: JobInsert[] = [];
    const store = makeStore();

    await portForFiles(files, jobInserts, store, readAttachmentFile)
      .ingest({ workspaceId: WS, workflowId: 5, messageId: 45, continuation: CONTINUATION });

    // Each attempt inflates up to the 32 MiB cap before it fails: one attempt spends the budget.
    expect(readAttachmentFile).toHaveBeenCalledTimes(1);
    expect(store.persistReport).not.toHaveBeenCalled();
    expect(eventVars(jobInserts.filter((j) => j.table === 'job_queue')[0])['dmarc.ok']).toBe(false);
  });

  test('a small corrupt archive does not block the report next to it', async () => {
    const jobInserts: JobInsert[] = [];
    const store = makeStore();
    const truncated = gzipSync(Buffer.from(REPORT_XML, 'utf8')).subarray(0, 40);

    await portForFiles({ 'broken.xml.gz': truncated, 'report.xml.gz': gzipSync(Buffer.from(REPORT_XML, 'utf8')) }, jobInserts, store)
      .ingest({ workspaceId: WS, workflowId: 5, messageId: 46, continuation: CONTINUATION });

    expect(persistedReportIds(store)).toEqual(['G-1']);
  });

  test('reads at most 20 report attachments of one message', async () => {
    const files: Record<string, Buffer> = {};
    for (let index = 0; index < 25; index += 1) {
      files[`r-${String(index).padStart(2, '0')}.xml`] = Buffer.from(reportXml(`R-${index}`, recordXml('10.0.0.1', 1, 'none', 'pass', 'pass')), 'utf8');
    }
    const readAttachmentFile = jest.fn(async (file: string) => files[basename(file)]!);
    const jobInserts: JobInsert[] = [];
    const store = makeStore();

    await portForFiles(files, jobInserts, store, readAttachmentFile)
      .ingest({ workspaceId: WS, workflowId: 5, messageId: 47, continuation: CONTINUATION });

    expect(readAttachmentFile).toHaveBeenCalledTimes(20);
    expect(store.persistReport).toHaveBeenCalledTimes(20);
    expect(eventVars(jobInserts.filter((j) => j.table === 'job_queue')[0])['dmarc.report_count']).toBe(20);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('20'));
  });

  test('applies the record limit of E13 to all reports of one message together', async () => {
    const record = '<record><row><count>1</count></row></record>';
    const jobInserts: JobInsert[] = [];
    const store = makeStore();

    await portForFiles({
      'a.xml': Buffer.from(reportXml('A', record.repeat(60_000)), 'utf8'),
      'b.xml': Buffer.from(reportXml('B', record.repeat(60_000)), 'utf8'),
      'c.xml': Buffer.from(reportXml('C', record.repeat(30_000)), 'utf8'),
    }, jobInserts, store).ingest({ workspaceId: WS, workflowId: 5, messageId: 48, continuation: CONTINUATION });

    // B would take the message to 120,000 records: logged and skipped; C still fits.
    expect(persistedReportIds(store)).toEqual(['A', 'C']);
    expect(eventVars(jobInserts.filter((j) => j.table === 'job_queue')[0])['dmarc.record_count']).toBe(90_000);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/"b\.xml".*60000.*100000/));
  });

  test('summarizes several reports exactly like the records of all reports taken together', async () => {
    const reports = {
      'a.xml': reportXml('A', recordXml('10.0.0.1', 5, 'none', 'pass', 'pass') + recordXml('10.0.0.2', 3, 'reject', 'fail', 'fail')),
      'b.xml': reportXml('B', recordXml('10.0.0.2', 2, 'quarantine', 'fail', 'fail')
        + recordXml('10.0.0.3', 5, 'none', 'pass', 'fail') + recordXml('', 4, 'none', 'fail', 'fail')),
      'c.xml': reportXml('C', recordXml('10.0.0.1', 0, 'none', 'fail', 'fail') + recordXml('10.0.0.4', 5, 'reject', 'fail', 'fail')),
    };
    const jobInserts: JobInsert[] = [];
    const store = makeStore();

    await portForFiles(
      Object.fromEntries(Object.entries(reports).map(([name, xml]) => [name, Buffer.from(xml, 'utf8')])),
      jobInserts,
      store,
    ).ingest({ workspaceId: WS, workflowId: 5, messageId: 49, continuation: CONTINUATION });

    // "Vorher": all records of all reports collected, then summarized at once.
    const before = summarizeDmarcRecords(Object.values(reports).flatMap((xml) => [...parseDmarcXml(xml)!.records]));
    const vars = eventVars(jobInserts.filter((j) => j.table === 'job_queue')[0]);
    expect({
      recordCount: vars['dmarc.record_count'],
      messageCount: vars['dmarc.message_count'],
      passCount: vars['dmarc.pass_count'],
      failCount: vars['dmarc.fail_count'],
      rejectCount: vars['dmarc.reject_count'],
      quarantineCount: vars['dmarc.quarantine_count'],
      unauthorizedSourceCount: vars['dmarc.unauthorized_source_count'],
      topSourceIp: vars['dmarc.top_source_ip'],
    }).toEqual(before);
    // Ties across reports keep the first IP seen.
    expect(before).toEqual({
      recordCount: 7,
      messageCount: 24,
      passCount: 10,
      failCount: 14,
      rejectCount: 8,
      quarantineCount: 2,
      unauthorizedSourceCount: 3,
      topSourceIp: '10.0.0.1',
    });
  });
});
