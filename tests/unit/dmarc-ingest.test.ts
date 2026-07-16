/**
 * @jest-environment node
 */
import {
  createPostgresWorkflowDmarcIngestPort,
  type WorkflowDmarcIngestJobPlan,
} from '../../packages/server/src/dmarc-ingest';
import type { DmarcStorePort } from '../../packages/server/src/db/postgres-dmarc-port';

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
