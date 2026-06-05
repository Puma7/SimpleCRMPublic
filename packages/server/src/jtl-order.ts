import type { Kysely, Selectable } from 'kysely';

import type {
  JtlOrderApiPort,
  JtlOrderInput,
  JtlOrderProductInput,
} from './api/types';
import type { CustomersTable, PostgresSecretPort, ServerDatabase } from './db';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
} from './db/workspace-context';
import {
  buildConnectionConfig,
  resolveMssqlSettingsForConnection,
  type MssqlSettingsInput,
} from './mssql-settings';

const MAX_ORDER_PRODUCTS = 200;
const MAX_INT = 2_147_483_647;
const MAX_SQL_DECIMAL = 999_999_999_999;

type JtlOrderCustomerRow = Pick<
  Selectable<CustomersTable>,
  | 'id'
  | 'jtl_kkunde'
  | 'name'
  | 'first_name'
  | 'company'
  | 'email'
  | 'phone'
  | 'mobile'
  | 'street'
  | 'zip_code'
  | 'city'
  | 'country'
  | 'notes'
  | 'source_row'
>;

export type PostgresJtlOrderPortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  secrets?: PostgresSecretPort;
  executeOrderSql?: JtlOrderSqlExecutor;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}>;

export type JtlOrderSqlParam = Readonly<
  | { name: string; type: 'Int'; value: number }
  | { name: string; type: 'NVarChar'; length: number; value: string | null }
  | { name: string; type: 'Char'; length: number; value: string | null }
  | { name: string; type: 'Decimal'; precision: number; scale: number; value: number }
>;

export type JtlOrderSqlExecutor = (input: {
  settings: MssqlSettingsInput;
  query: string;
  params: readonly JtlOrderSqlParam[];
}) => Promise<{ success: boolean; kAuftrag?: number; cAuftragsNr?: string; error?: string }>;

type NormalizedJtlOrder = JtlOrderInput & {
  products: readonly JtlOrderProductInput[];
};

export function createPostgresJtlOrderPort(options: PostgresJtlOrderPortOptions): JtlOrderApiPort {
  const executeOrderSql = options.executeOrderSql ?? executeJtlOrderSql;

  return {
    async createOrder(input) {
      const normalized = normalizeJtlOrderInput(input.order);
      if (!normalized.ok) return { success: false, error: normalized.error };

      const customer = await selectJtlOrderCustomer(
        options.db,
        input.workspaceId,
        normalized.order.simpleCrmCustomerId,
        options.applyWorkspaceSession,
      );
      if (!customer || customer.jtl_kkunde == null) {
        return {
          success: false,
          error: `Customer with SimpleCRM ID ${normalized.order.simpleCrmCustomerId} not found or not synced with JTL (missing jtl_kKunde).`,
        };
      }

      const settings = await resolveMssqlSettingsForConnection({
        db: options.db,
        secrets: options.secrets,
        applyWorkspaceSession: options.applyWorkspaceSession,
        workspaceId: input.workspaceId,
      });
      if (!settings.ok) return { success: false, error: settings.error };

      const baseSettingsValidation = validateJtlBaseSettings(settings.settings);
      if (!baseSettingsValidation.ok) return { success: false, error: baseSettingsValidation.error };

      const prepared = buildJtlOrderSql({
        order: normalized.order,
        customer,
        settings: settings.settings,
      });

      const result = await executeOrderSql({
        settings: settings.settings,
        query: prepared.query,
        params: prepared.params,
      });
      if (!result.success) {
        return { success: false, error: result.error ?? 'JTL order creation failed due to a SQL error.' };
      }
      if (result.kAuftrag === undefined || result.cAuftragsNr === undefined) {
        return { success: false, error: 'JTL order creation did not return an order id.' };
      }
      return {
        success: true,
        jtlOrderId: result.kAuftrag,
        jtlOrderNumber: result.cAuftragsNr,
      };
    },
  };
}

export function normalizeJtlOrderInput(input: JtlOrderInput): { ok: true; order: NormalizedJtlOrder } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'JTL order payload muss ein Objekt sein' };
  }

  const simpleCrmCustomerId = normalizePositiveInteger(input.simpleCrmCustomerId);
  if (simpleCrmCustomerId === null) return { ok: false, error: 'simpleCrmCustomerId muss eine positive Ganzzahl sein' };

  const kFirma = normalizePositiveInteger(input.kFirma);
  if (kFirma === null) return { ok: false, error: 'kFirma muss eine positive Ganzzahl sein' };

  const kWarenlager = normalizePositiveInteger(input.kWarenlager);
  if (kWarenlager === null) return { ok: false, error: 'kWarenlager muss eine positive Ganzzahl sein' };

  const kZahlungsart = normalizePositiveInteger(input.kZahlungsart);
  if (kZahlungsart === null) return { ok: false, error: 'kZahlungsart muss eine positive Ganzzahl sein' };

  const kVersandart = normalizePositiveInteger(input.kVersandart);
  if (kVersandart === null) return { ok: false, error: 'kVersandart muss eine positive Ganzzahl sein' };

  if (!Array.isArray(input.products) || input.products.length === 0) {
    return { ok: false, error: 'No products provided for the order.' };
  }
  if (input.products.length > MAX_ORDER_PRODUCTS) {
    return { ok: false, error: `Zu viele Produkte (max ${MAX_ORDER_PRODUCTS})` };
  }

  const products: JtlOrderProductInput[] = [];
  for (const [index, product] of input.products.entries()) {
    if (!product || typeof product !== 'object') {
      return { ok: false, error: `Produkt ${index + 1} muss ein Objekt sein` };
    }
    const kArtikel = normalizePositiveInteger(product.kArtikel);
    if (kArtikel === null) return { ok: false, error: `Produkt ${index + 1}: kArtikel muss eine positive Ganzzahl sein` };
    const nAnzahl = normalizePositiveNumber(product.nAnzahl);
    if (nAnzahl === null) return { ok: false, error: `Produkt ${index + 1}: nAnzahl muss eine positive Zahl sein` };
    const fPreis = normalizeNonNegativeNumber(product.fPreis);
    if (fPreis === null) return { ok: false, error: `Produkt ${index + 1}: fPreis muss eine nicht-negative Zahl sein` };
    products.push({
      kArtikel,
      nAnzahl,
      fPreis,
      ...(typeof product.cName === 'string' ? { cName: product.cName.slice(0, 510) } : {}),
      ...(typeof product.cArtNr === 'string' ? { cArtNr: product.cArtNr.slice(0, 200) } : {}),
    });
  }

  return {
    ok: true,
    order: {
      simpleCrmCustomerId,
      kFirma,
      kWarenlager,
      kZahlungsart,
      kVersandart,
      products,
    },
  };
}

export function buildJtlOrderSql(input: {
  order: NormalizedJtlOrder;
  customer: JtlOrderCustomerRow;
  settings: MssqlSettingsInput;
}): { query: string; params: readonly JtlOrderSqlParam[] } {
  const customer = mapJtlOrderCustomer(input.customer);
  const currency = normalizeCurrency(input.settings.cWaehrung) ?? 'EUR';
  const currencyFactor = normalizePositiveNumber(input.settings.fWaehrungFaktor) ?? 1;
  const salutation = customer.salutation;
  const raAnrede = salutation.includes('Herr') ? 'Herr' : salutation.includes('Frau') ? 'Frau' : null;
  const lowerSalutation = salutation.toLowerCase();
  const raTitel = lowerSalutation.includes('dr.')
    ? 'Dr.'
    : lowerSalutation.includes('prof.')
      ? 'Prof.'
      : null;

  const params: JtlOrderSqlParam[] = [
    intParam('App_kKunde', Number(input.customer.jtl_kkunde)),
    intParam('App_kBenutzer', input.settings.kBenutzer!),
    intParam('App_kShop', input.settings.kShop!),
    intParam('App_kPlattform', input.settings.kPlattform!),
    intParam('App_kSprache', input.settings.kSprache!),
    intParam('App_kFirma', input.order.kFirma),
    intParam('App_kWarenlager', input.order.kWarenlager),
    intParam('App_kZahlungsart', input.order.kZahlungsart),
    intParam('App_kVersandart', input.order.kVersandart),
    nvarCharParam('App_cWaehrung', 3, currency),
    decimalParam('App_fWaehrungFaktor', 25, 13, currencyFactor),
    charParam('App_cVersandlandWaehrung', 3, currency),
    decimalParam('App_fVersandlandWaehrungFaktor', 25, 13, currencyFactor),
    nvarCharParam('RA_cFirma', 256, customer.company),
    nvarCharParam('RA_cVorname', 510, customer.firstName),
    nvarCharParam('RA_cName', 510, customer.lastName),
    nvarCharParam('RA_cStrasse', 510, customer.street),
    nvarCharParam('RA_cPLZ', 48, customer.zipCode),
    nvarCharParam('RA_cOrt', 510, customer.city),
    nvarCharParam('RA_cLand', 510, customer.countryName),
    nvarCharParam('RA_cISO', 10, customer.countryIso),
    nvarCharParam('RA_cTel', 510, customer.phone),
    nvarCharParam('RA_cMail', 510, customer.email),
    nvarCharParam('RA_cZusatz', 510, customer.notes),
    nvarCharParam('LA_cFirma', 256, customer.company),
    nvarCharParam('LA_cVorname', 510, customer.firstName),
    nvarCharParam('LA_cName', 510, customer.lastName),
    nvarCharParam('LA_cStrasse', 510, customer.street),
    nvarCharParam('LA_cPLZ', 48, customer.zipCode),
    nvarCharParam('LA_cOrt', 510, customer.city),
    nvarCharParam('LA_cLand', 510, customer.countryName),
    nvarCharParam('LA_cISO', 10, customer.countryIso),
    nvarCharParam('LA_cTel', 510, customer.phone),
    nvarCharParam('LA_cMail', 510, customer.email),
    nvarCharParam('RA_cAnrede', 255, raAnrede),
    nvarCharParam('RA_cTitel', 255, raTitel),
    nvarCharParam('LA_cAnrede', 255, raAnrede),
    nvarCharParam('LA_cTitel', 255, raTitel),
  ];

  const artikelListeSql = buildArticleListSql(input.order.products);
  const query = `
BEGIN TRANSACTION;
BEGIN TRY
  DECLARE @App_cAuftragsNr NVARCHAR(100) = N'EXTERN-' + CONVERT(NVARCHAR(50), GETDATE(), 112) + N'-N' + RIGHT('0000' + CAST(ABS(CHECKSUM(NEWID())) % 10000 AS VARCHAR(4)), 4);

  ${artikelListeSql}

  DECLARE @NeuerKAuftrag INT;

  INSERT INTO Verkauf.tAuftrag (
    kBenutzer, kKunde, cAuftragsNr, nType, dErstellt, dErstelltWawi,
    kShop, kPlattform, kSprache, cWaehrung, fFaktor, kFirmaHistory, kWarenlager,
    kZahlungsart, kVersandart, cVersandlandISO,
    nBeschreibung, cInet, nSteuereinstellung,
    cVersandlandWaehrung, fVersandlandWaehrungFaktor,
    nHatUpload, fZusatzGewicht, nStorno, nKomplettAusgeliefert,
    nLieferPrioritaet, nPremiumVersand, nIstExterneRechnung, nIstReadOnly,
    nArchiv, nReserviert, nAuftragStatus, fFinanzierungskosten,
    nPending, kBenutzerErstellt, nSteuersonderbehandlung
  ) VALUES (
    @App_kBenutzer, @App_kKunde, @App_cAuftragsNr, 1, GETDATE(), GETDATE(),
    @App_kShop, @App_kPlattform, @App_kSprache, @App_cWaehrung, @App_fWaehrungFaktor, @App_kFirma, @App_kWarenlager,
    @App_kZahlungsart, @App_kVersandart, @LA_cISO,
    0, '0', 0,
    @App_cVersandlandWaehrung, @App_fVersandlandWaehrungFaktor,
    0, 0.0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0.0,
    0, @App_kBenutzer, 0
  );
  SET @NeuerKAuftrag = SCOPE_IDENTITY();

  INSERT INTO Verkauf.tAuftragAdresse (
    kAuftrag, kKunde, nTyp, cFirma, cAnrede, cTitel, cVorname, cName, cStrasse, cPLZ, cOrt, cLand, cISO, cTel, cMail, cZusatz
  ) VALUES (
    @NeuerKAuftrag, @App_kKunde, 1,
    @RA_cFirma, @RA_cAnrede, @RA_cTitel, @RA_cVorname, @RA_cName, @RA_cStrasse, @RA_cPLZ, @RA_cOrt, @RA_cLand, @RA_cISO, @RA_cTel, @RA_cMail, @RA_cZusatz
  );

  INSERT INTO Verkauf.tAuftragAdresse (
    kAuftrag, kKunde, nTyp, cFirma, cAnrede, cTitel, cVorname, cName, cStrasse, cPLZ, cOrt, cLand, cISO, cTel, cMail
  ) VALUES (
    @NeuerKAuftrag, @App_kKunde, 0,
    @LA_cFirma, @LA_cAnrede, @LA_cTitel, @LA_cVorname, @LA_cName, @LA_cStrasse, @LA_cPLZ, @LA_cOrt, @LA_cLand, @LA_cISO, @LA_cTel, @LA_cMail
  );

  DECLARE cur CURSOR LOCAL FAST_FORWARD FOR SELECT kArtikel, fAnzahl, fPreisNetto, Reihenfolge FROM @App_ArtikelListe ORDER BY Reihenfolge;
  DECLARE @Pos_kArtikel INT, @Pos_fAnzahl DECIMAL(25,13), @Pos_fPreisNetto DECIMAL(25,13), @Pos_Reihenfolge INT;
  OPEN cur;
  FETCH NEXT FROM cur INTO @Pos_kArtikel, @Pos_fAnzahl, @Pos_fPreisNetto, @Pos_Reihenfolge;
  WHILE @@FETCH_STATUS = 0
  BEGIN
    DECLARE @Pos_cArtNr NVARCHAR(200), @Pos_cName NVARCHAR(510), @Pos_kSteuerklasse INT, @Pos_fMwSt DECIMAL(25,13), @Pos_cEinheit NVARCHAR(510);

    SELECT TOP 1
      @Pos_cArtNr = tA.cArtNr,
      @Pos_cName = ISNULL(tAB.cName, tA.cArtNr),
      @Pos_kSteuerklasse = tA.kSteuerklasse,
      @Pos_fMwSt = ISNULL(
        (SELECT TOP 1 ts.fSteuersatz
          FROM dbo.tSteuersatz ts
          WHERE ts.kSteuerklasse = tA.kSteuerklasse
            AND ts.kSteuerzone = 1
          ORDER BY ts.nPrio DESC, ts.kSteuersatz DESC),
        0
      ),
      @Pos_cEinheit = N''
    FROM dbo.tArtikel tA
    LEFT JOIN dbo.tArtikelBeschreibung tAB ON tA.kArtikel = tAB.kArtikel AND tAB.kSprache = @App_kSprache AND tAB.kPlattform = @App_kPlattform
    WHERE tA.kArtikel = @Pos_kArtikel;

    INSERT INTO Verkauf.tAuftragPosition (
      kArtikel, kAuftrag, cArtNr, cName, fAnzahl, fVkNetto, fMwSt, nSort, kSteuerklasse, nType, cEinheit,
      fEkNetto, fRabatt, cNameStandard, cHinweis
    ) VALUES (
      @Pos_kArtikel, @NeuerKAuftrag, @Pos_cArtNr, @Pos_cName, @Pos_fAnzahl, @Pos_fPreisNetto, @Pos_fMwSt, @Pos_Reihenfolge, @Pos_kSteuerklasse, 1, @Pos_cEinheit,
      0, 0, @Pos_cName, N''
    );

    FETCH NEXT FROM cur INTO @Pos_kArtikel, @Pos_fAnzahl, @Pos_fPreisNetto, @Pos_Reihenfolge;
  END
  CLOSE cur;
  DEALLOCATE cur;

  DECLARE @tvpAuftragEckdaten Verkauf.TYPE_spAuftragEckdatenBerechnen;
  INSERT INTO @tvpAuftragEckdaten (kAuftrag) VALUES (@NeuerKAuftrag);
  EXEC Verkauf.spAuftragEckdatenBerechnen @auftrag = @tvpAuftragEckdaten;

  COMMIT TRANSACTION;
  SELECT @NeuerKAuftrag AS kAuftrag, @App_cAuftragsNr AS cAuftragsNr;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
`;

  return { query, params };
}

async function selectJtlOrderCustomer(
  db: Kysely<ServerDatabase>,
  workspaceId: string,
  customerId: number,
  applyWorkspaceSession?: WorkspaceSessionApplier,
): Promise<JtlOrderCustomerRow | null> {
  const row = await withWorkspaceTransaction(
    db,
    { workspaceId, role: 'system' },
    (trx) => trx
      .selectFrom('customers')
      .select([
        'id',
        'jtl_kkunde',
        'name',
        'first_name',
        'company',
        'email',
        'phone',
        'mobile',
        'street',
        'zip_code',
        'city',
        'country',
        'notes',
        'source_row',
      ])
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', customerId)
      .executeTakeFirst(),
    { applySession: applyWorkspaceSession },
  );
  return row ?? null;
}

function validateJtlBaseSettings(settings: MssqlSettingsInput): { ok: true } | { ok: false; error: string } {
  if (
    settings.kBenutzer === undefined
    || settings.kShop === undefined
    || settings.kPlattform === undefined
    || settings.kSprache === undefined
  ) {
    return {
      ok: false,
      error: 'JTL Wawi connection or required base settings (kBenutzer, kShop, kPlattform, kSprache) not configured.',
    };
  }
  return { ok: true };
}

function buildArticleListSql(products: readonly JtlOrderProductInput[]): string {
  let sql = 'DECLARE @App_ArtikelListe TABLE (kArtikel INT, fAnzahl DECIMAL(25,13), fPreisNetto DECIMAL(25,13), Reihenfolge INT)\n';
  for (const [index, product] of products.entries()) {
    sql += `INSERT INTO @App_ArtikelListe (kArtikel, fAnzahl, fPreisNetto, Reihenfolge) VALUES (${product.kArtikel}, ${formatSqlDecimal(product.nAnzahl)}, ${formatSqlDecimal(product.fPreis)}, ${index + 1})\n`;
  }
  return sql;
}

async function executeJtlOrderSql(input: {
  settings: MssqlSettingsInput;
  query: string;
  params: readonly JtlOrderSqlParam[];
}): Promise<{ success: boolean; kAuftrag?: number; cAuftragsNr?: string; error?: string }> {
  let pool: { request(): unknown; close(): Promise<void> | void } | null = null;
  try {
    const sql = await import('mssql');
    pool = await new sql.ConnectionPool(buildConnectionConfig(input.settings)).connect();
    const request = pool.request() as {
      input(name: string, type: unknown, value: unknown): void;
      query(query: string): Promise<{ recordset?: unknown[] }>;
    };
    for (const param of input.params) {
      bindMssqlParam(sql, request, param);
    }
    const result = await request.query(input.query);
    const row = result.recordset?.[0];
    if (!isRecord(row)) return { success: true };
    return {
      success: true,
      kAuftrag: normalizePositiveInteger(row.kAuftrag) ?? undefined,
      cAuftragsNr: typeof row.cAuftragsNr === 'string' ? row.cAuftragsNr : undefined,
    };
  } catch (error) {
    return { success: false, error: mssqlErrorMessage(error) };
  } finally {
    await pool?.close();
  }
}

function bindMssqlParam(
  sql: typeof import('mssql'),
  request: { input(name: string, type: unknown, value: unknown): void },
  param: JtlOrderSqlParam,
) {
  if (param.type === 'Int') {
    request.input(param.name, sql.Int, param.value);
    return;
  }
  if (param.type === 'Decimal') {
    request.input(param.name, sql.Decimal(param.precision, param.scale), param.value);
    return;
  }
  if (param.type === 'Char') {
    request.input(param.name, sql.Char(param.length), param.value);
    return;
  }
  request.input(param.name, sql.NVarChar(param.length), param.value);
}

function mapJtlOrderCustomer(row: JtlOrderCustomerRow): {
  company: string | null;
  firstName: string | null;
  lastName: string | null;
  street: string | null;
  zipCode: string | null;
  city: string | null;
  countryName: string;
  countryIso: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  salutation: string;
} {
  const source = isRecord(row.source_row) ? row.source_row : {};
  const sourceCompany = sourceText(source, 'company_name') ?? sourceText(source, 'company');
  const contactPerson = sourceText(source, 'contact_person_name');
  const isCompany = sourceBoolean(source, 'is_company') ?? Boolean(row.company || sourceCompany);
  const displayName = isCompany
    ? (contactPerson ?? row.name ?? '')
    : (row.name ?? '');
  const parts = splitPersonName(row.first_name, displayName);
  const countryName = row.country?.trim() || sourceText(source, 'country') || 'Deutschland';
  return {
    company: isCompany ? textOrNull(row.company ?? sourceCompany ?? row.name) : null,
    firstName: textOrNull(parts.firstName),
    lastName: textOrNull(parts.lastName),
    street: textOrNull(row.street),
    zipCode: textOrNull(row.zip_code),
    city: textOrNull(row.city),
    countryName,
    countryIso: normalizeCountryIso(sourceText(source, 'country_iso') ?? sourceText(source, 'cISO'), countryName),
    phone: textOrNull(row.phone ?? row.mobile),
    email: textOrNull(row.email),
    notes: textOrNull(row.notes),
    salutation: sourceText(source, 'salutation') ?? '',
  };
}

function splitPersonName(firstName: string | null, fullName: string): { firstName: string; lastName: string } {
  const full = fullName.trim();
  const first = firstName?.trim();
  if (first) {
    const remaining = full.toLowerCase().startsWith(first.toLowerCase())
      ? full.slice(first.length).trim()
      : full;
    return { firstName: first, lastName: remaining || full || first };
  }
  const parts = full.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: '', lastName: full };
  return {
    firstName: parts[0] ?? '',
    lastName: parts.slice(1).join(' '),
  };
}

function intParam(name: string, value: number): JtlOrderSqlParam {
  return { name, type: 'Int', value };
}

function nvarCharParam(name: string, length: number, value: string | null): JtlOrderSqlParam {
  return { name, type: 'NVarChar', length, value: value === null ? null : value.slice(0, length) };
}

function charParam(name: string, length: number, value: string | null): JtlOrderSqlParam {
  return { name, type: 'Char', length, value: value === null ? null : value.slice(0, length) };
}

function decimalParam(name: string, precision: number, scale: number, value: number): JtlOrderSqlParam {
  return { name, type: 'Decimal', precision, scale, value };
}

function normalizePositiveInteger(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isSafeInteger(n) && n > 0 && n <= MAX_INT ? n : null;
}

function normalizePositiveNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 && n <= MAX_SQL_DECIMAL ? n : null;
}

function normalizeNonNegativeNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= MAX_SQL_DECIMAL ? n : null;
}

function normalizeCurrency(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(text) ? text : null;
}

function normalizeCountryIso(value: string | null | undefined, countryName: string): string {
  const direct = value?.trim().toUpperCase();
  if (direct && /^[A-Z]{2,3}$/.test(direct)) return direct;
  const country = countryName.trim().toLowerCase();
  if (country === 'deutschland' || country === 'germany') return 'DE';
  return 'DE';
}

function formatSqlDecimal(value: number): string {
  const text = value.toFixed(13).replace(/0+$/, '').replace(/\.$/, '');
  return text === '-0' ? '0' : text;
}

function sourceText(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text : null;
}

function sourceBoolean(source: Record<string, unknown>, key: string): boolean | null {
  const value = source[key];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : null;
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (text === 'true' || text === '1' || text === 'yes' || text === 'y') return true;
    if (text === 'false' || text === '0' || text === 'no' || text === 'n') return false;
  }
  return null;
}

function textOrNull(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function mssqlErrorMessage(error: unknown): string {
  if (isRecord(error)) {
    const originalError = error.originalError;
    if (isRecord(originalError) && typeof originalError.message === 'string') return originalError.message;
    if (typeof error.message === 'string') return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}
