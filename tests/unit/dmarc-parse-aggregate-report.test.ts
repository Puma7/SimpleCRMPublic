/**
 * @jest-environment node
 */
import { crc32, gzipSync } from 'node:zlib';

import {
  MAX_DECOMPRESSED_BYTES,
  decompressReportAttachment,
  parseDmarcReportAttachment,
  parseDmarcXml,
  summarizeDmarcRecords,
  type DmarcRecordRow,
} from '../../packages/server/src/dmarc/parse-aggregate-report';

// A realistic Google-style RUA report: one aligned-pass row (legit Google relay)
// and one both-fail row that the provider rejected (a spoofer using our domain).
const REPORT_XML = `<?xml version="1.0" encoding="UTF-8" ?>
<feedback>
  <report_metadata>
    <org_name>google.com</org_name>
    <email>noreply-dmarc-support@google.com</email>
    <report_id>10148401413361896365</report_id>
    <date_range>
      <begin>1720396800</begin>
      <end>1720483199</end>
    </date_range>
  </report_metadata>
  <policy_published>
    <domain>leinfelder.me</domain>
    <adkim>r</adkim>
    <aspf>r</aspf>
    <p>reject</p>
    <sp>reject</sp>
    <pct>100</pct>
  </policy_published>
  <record>
    <row>
      <source_ip>209.85.220.41</source_ip>
      <count>7</count>
      <policy_evaluated>
        <disposition>none</disposition>
        <dkim>pass</dkim>
        <spf>pass</spf>
      </policy_evaluated>
    </row>
    <identifiers>
      <header_from>leinfelder.me</header_from>
    </identifiers>
    <auth_results>
      <dkim>
        <domain>leinfelder.me</domain>
        <result>pass</result>
        <selector>google</selector>
      </dkim>
      <spf>
        <domain>leinfelder.me</domain>
        <result>pass</result>
      </spf>
    </auth_results>
  </record>
  <record>
    <row>
      <source_ip>45.83.12.9</source_ip>
      <count>3</count>
      <policy_evaluated>
        <disposition>reject</disposition>
        <dkim>fail</dkim>
        <spf>fail</spf>
      </policy_evaluated>
    </row>
    <identifiers>
      <header_from>leinfelder.me</header_from>
      <envelope_from>evil.example</envelope_from>
    </identifiers>
    <auth_results>
      <spf>
        <domain>evil.example</domain>
        <result>fail</result>
      </spf>
    </auth_results>
  </record>
</feedback>`;

/** Build a minimal single-entry STORED (uncompressed) zip so tests need no zip
 *  writer dependency. yauzl validates the CRC, so we compute a real one. */
function buildStoredZip(name: string, content: string): Buffer {
  const data = Buffer.from(content, 'utf8');
  const nameBuf = Buffer.from(name, 'utf8');
  const crc = crc32(data) >>> 0;

  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0);
  lh.writeUInt16LE(20, 4);
  lh.writeUInt32LE(crc, 14);
  lh.writeUInt32LE(data.length, 18);
  lh.writeUInt32LE(data.length, 22);
  lh.writeUInt16LE(nameBuf.length, 26);

  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(20, 4);
  cd.writeUInt16LE(20, 6);
  cd.writeUInt32LE(crc, 16);
  cd.writeUInt32LE(data.length, 20);
  cd.writeUInt32LE(data.length, 24);
  cd.writeUInt16LE(nameBuf.length, 28);

  const localPart = Buffer.concat([lh, nameBuf, data]);
  const cdPart = Buffer.concat([cd, nameBuf]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cdPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);

  return Buffer.concat([localPart, cdPart, eocd]);
}

describe('parseDmarcXml', () => {
  test('parses metadata, policy and records from a full RUA report', () => {
    const report = parseDmarcXml(REPORT_XML);
    expect(report).not.toBeNull();
    if (!report) return;

    expect(report.orgName).toBe('google.com');
    expect(report.reportId).toBe('10148401413361896365'); // kept as string (64-bit safe)
    expect(report.email).toBe('noreply-dmarc-support@google.com');
    expect(report.domain).toBe('leinfelder.me');
    expect(report.dateBegin.getTime()).toBe(1720396800 * 1000);
    expect(report.dateEnd.getTime()).toBe(1720483199 * 1000);
    expect(report.policy).toEqual({ p: 'reject', sp: 'reject', pct: 100, adkim: 'r', aspf: 'r' });

    expect(report.records).toHaveLength(2);
    const [legit, spoof] = report.records;
    expect(legit).toMatchObject({
      sourceIp: '209.85.220.41',
      count: 7,
      disposition: 'none',
      dkimEval: 'pass',
      spfEval: 'pass',
      headerFrom: 'leinfelder.me',
      envelopeFrom: null,
      dkimDomains: ['leinfelder.me'],
      spfDomains: ['leinfelder.me'],
    });
    expect(spoof).toMatchObject({
      sourceIp: '45.83.12.9',
      count: 3,
      disposition: 'reject',
      dkimEval: 'fail',
      spfEval: 'fail',
      headerFrom: 'leinfelder.me',
      envelopeFrom: 'evil.example',
      dkimDomains: [],
      spfDomains: ['evil.example'],
    });
  });

  test('normalizes a single <record> (not an array) into a one-element list', () => {
    const xml = `<feedback>
      <report_metadata><org_name>Enterprise</org_name><report_id>abc-1</report_id>
        <date_range><begin>100</begin><end>200</end></date_range></report_metadata>
      <policy_published><domain>example.com</domain><p>none</p></policy_published>
      <record><row><source_ip>1.2.3.4</source_ip><count>1</count>
        <policy_evaluated><disposition>none</disposition><dkim>pass</dkim><spf>fail</spf></policy_evaluated>
      </row><identifiers><header_from>example.com</header_from></identifiers></record>
    </feedback>`;
    const report = parseDmarcXml(xml);
    expect(report?.records).toHaveLength(1);
    expect(report?.records[0]?.sourceIp).toBe('1.2.3.4');
    expect(report?.policy.pct).toBeNull();
  });

  test('collects multiple DKIM auth_results domains', () => {
    const xml = `<feedback>
      <report_metadata><org_name>o</org_name><report_id>r</report_id>
        <date_range><begin>1</begin><end>2</end></date_range></report_metadata>
      <policy_published><domain>d.com</domain></policy_published>
      <record><row><source_ip>9.9.9.9</source_ip><count>2</count>
        <policy_evaluated><disposition>none</disposition><dkim>pass</dkim><spf>pass</spf></policy_evaluated></row>
        <auth_results>
          <dkim><domain>a.com</domain><result>pass</result></dkim>
          <dkim><domain>b.com</domain><result>fail</result></dkim>
        </auth_results></record>
    </feedback>`;
    expect(parseDmarcXml(xml)?.records[0]?.dkimDomains).toEqual(['a.com', 'b.com']);
  });

  test('returns null for non-DMARC XML and for garbage', () => {
    expect(parseDmarcXml('<html><body>not a report</body></html>')).toBeNull();
    expect(parseDmarcXml('')).toBeNull();
    expect(parseDmarcXml('<<< not xml at all')).toBeNull();
  });

  test('returns null when required identity fields are missing', () => {
    const xml = `<feedback>
      <report_metadata><report_id>only-id</report_id></report_metadata>
      <policy_published><domain>d.com</domain></policy_published>
    </feedback>`;
    expect(parseDmarcXml(xml)).toBeNull(); // org_name missing
  });
});

describe('decompressReportAttachment', () => {
  test('gunzips a *.xml.gz attachment', async () => {
    const gz = gzipSync(Buffer.from(REPORT_XML, 'utf8'));
    const out = await decompressReportAttachment('leinfelder.me!google.com!1720.xml.gz', gz);
    expect(out.toString('utf8')).toBe(REPORT_XML);
  });

  test('extracts the first *.xml entry from a *.zip attachment', async () => {
    const zip = buildStoredZip('leinfelder.me!google.com!1720.xml', REPORT_XML);
    const out = await decompressReportAttachment('report.zip', zip);
    expect(out.toString('utf8')).toBe(REPORT_XML);
  });

  test('detects gzip by magic bytes even with a wrong extension', async () => {
    const gz = gzipSync(Buffer.from(REPORT_XML, 'utf8'));
    const out = await decompressReportAttachment('report.xml', gz); // lies about extension
    expect(out.toString('utf8')).toBe(REPORT_XML);
  });

  test('passes plain XML through unchanged', async () => {
    const out = await decompressReportAttachment('report.xml', Buffer.from(REPORT_XML, 'utf8'));
    expect(out.toString('utf8')).toBe(REPORT_XML);
  });

  test('rejects a gzip bomb that exceeds the decompression cap', async () => {
    const bomb = gzipSync(Buffer.alloc(MAX_DECOMPRESSED_BYTES + 1024, 0x41));
    await expect(decompressReportAttachment('bomb.xml.gz', bomb)).rejects.toThrow();
  });
});

describe('parseDmarcReportAttachment', () => {
  test('decompresses and parses end-to-end from gzip', async () => {
    const gz = gzipSync(Buffer.from(REPORT_XML, 'utf8'));
    const report = await parseDmarcReportAttachment('a.xml.gz', gz);
    expect(report?.orgName).toBe('google.com');
    expect(report?.records).toHaveLength(2);
  });

  test('returns null for a corrupt archive instead of throwing', async () => {
    const corrupt = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0xde, 0xad, 0xbe, 0xef]);
    await expect(parseDmarcReportAttachment('broken.xml.gz', corrupt)).resolves.toBeNull();
  });

  test('returns null for a non-report attachment (plain text)', async () => {
    const report = await parseDmarcReportAttachment('readme.txt', Buffer.from('hello world'));
    expect(report).toBeNull();
  });
});

describe('summarizeDmarcRecords', () => {
  test('aggregates pass/fail/disposition counters and top source IP', () => {
    const report = parseDmarcXml(REPORT_XML);
    const summary = summarizeDmarcRecords(report?.records ?? []);
    expect(summary).toEqual({
      recordCount: 2,
      messageCount: 10,
      passCount: 7,
      failCount: 3,
      rejectCount: 3,
      quarantineCount: 0,
      unauthorizedSourceCount: 1,
      topSourceIp: '209.85.220.41',
    });
  });

  test('counts quarantine dispositions and distinct unauthorized sources', () => {
    const rows: DmarcRecordRow[] = [
      { sourceIp: '1.1.1.1', count: 5, disposition: 'quarantine', dkimEval: 'fail', spfEval: 'fail', headerFrom: 'd', envelopeFrom: null, dkimDomains: [], spfDomains: [] },
      { sourceIp: '1.1.1.1', count: 2, disposition: 'none', dkimEval: 'fail', spfEval: 'fail', headerFrom: 'd', envelopeFrom: null, dkimDomains: [], spfDomains: [] },
      { sourceIp: '2.2.2.2', count: 4, disposition: 'none', dkimEval: 'pass', spfEval: 'fail', headerFrom: 'd', envelopeFrom: null, dkimDomains: [], spfDomains: [] },
    ];
    const summary = summarizeDmarcRecords(rows);
    expect(summary.quarantineCount).toBe(5);
    expect(summary.failCount).toBe(7); // 5 + 2 both-fail rows
    expect(summary.passCount).toBe(4); // dkim pass aligns
    expect(summary.unauthorizedSourceCount).toBe(1); // only 1.1.1.1 fully fails
    expect(summary.topSourceIp).toBe('1.1.1.1'); // volume 7 vs 4
  });

  test('handles an empty record set', () => {
    expect(summarizeDmarcRecords([])).toEqual({
      recordCount: 0,
      messageCount: 0,
      passCount: 0,
      failCount: 0,
      rejectCount: 0,
      quarantineCount: 0,
      unauthorizedSourceCount: 0,
      topSourceIp: null,
    });
  });
});
