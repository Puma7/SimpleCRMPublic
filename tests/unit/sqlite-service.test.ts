// Mock electron and fs BEFORE any imports (jest.mock is hoisted)
jest.mock('electron', () => ({
  app: { getPath: jest.fn(() => '/tmp/test-crm') },
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(() => true), // Simulate DB already exists
  promises: { writeFile: jest.fn() },
}));

// Build a reusable mock statement factory
function makeStmt(returnValue?: any) {
  return {
    all: jest.fn(() => (returnValue !== undefined ? returnValue : [])),
    get: jest.fn(() => returnValue),
    run: jest.fn(() => ({ changes: 1, lastInsertRowid: 1 })),
  };
}

// Build the mock DB that better-sqlite3 constructor returns
const mockDb = {
  prepare: jest.fn(),
  exec: jest.fn(),
  pragma: jest.fn(),
  transaction: jest.fn((fn: Function) => fn), // returns fn directly
  isDestroyed: jest.fn(() => false),
};

// Mock better-sqlite3 constructor
const MockDatabase = jest.fn(() => mockDb);
jest.mock('better-sqlite3', () => MockDatabase);

// Mock the database-schema module with table name constants
jest.mock('../../electron/database-schema', () => ({
  createCustomersTable: 'CREATE TABLE customers ...',
  createProductsTable: 'CREATE TABLE products ...',
  createSyncInfoTable: 'CREATE TABLE sync_info ...',
  createDealProductsTable: 'CREATE TABLE deal_products ...',
  createCalendarEventsTable: 'CREATE TABLE calendar_events ...',
  createDealsTable: 'CREATE TABLE deals ...',
  createTasksTable: 'CREATE TABLE tasks ...',
  createCustomerCustomFieldsTable: 'CREATE TABLE customer_custom_fields ...',
  createCustomerCustomFieldValuesTable: 'CREATE TABLE customer_custom_field_values ...',
  createJtlFirmenTable: 'CREATE TABLE jtl_firmen ...',
  createJtlWarenlagerTable: 'CREATE TABLE jtl_warenlager ...',
  createJtlZahlungsartenTable: 'CREATE TABLE jtl_zahlungsarten ...',
  createJtlVersandartenTable: 'CREATE TABLE jtl_versandarten ...',
  createActivityLogTable: 'CREATE TABLE activity_log ...',
  createSavedViewsTable: 'CREATE TABLE saved_views ...',
  indexes: [],
  CUSTOMERS_TABLE: 'customers',
  PRODUCTS_TABLE: 'products',
  DEAL_PRODUCTS_TABLE: 'deal_products',
  SYNC_INFO_TABLE: 'sync_info',
  CALENDAR_EVENTS_TABLE: 'calendar_events',
  DEALS_TABLE: 'deals',
  TASKS_TABLE: 'tasks',
  CUSTOMER_CUSTOM_FIELDS_TABLE: 'customer_custom_fields',
  CUSTOMER_CUSTOM_FIELD_VALUES_TABLE: 'customer_custom_field_values',
  JTL_FIRMEN_TABLE: 'jtl_firmen',
  JTL_WARENLAGER_TABLE: 'jtl_warenlager',
  JTL_ZAHLUNGSARTEN_TABLE: 'jtl_zahlungsarten',
  JTL_VERSANDARTEN_TABLE: 'jtl_versandarten',
  ACTIVITY_LOG_TABLE: 'activity_log',
  SAVED_VIEWS_TABLE: 'saved_views',
}));

const {
  initializeDatabase,
  getDb,
  getSyncInfo,
  setSyncInfo,
  getAllCustomFields,
  getActiveCustomFields,
  getCustomFieldById,
  createCustomField,
  deleteCustomField,
  getCustomFieldValuesForCustomer,
  deleteCustomFieldValue,
  getCustomersPage,
  searchProducts,
  createTask,
  getAllTasks,
  getTaskById,
  getUpcomingTasks,
  getFollowUpItems,
  getTasksForCustomer,
  getTasksForDeal,
} = require('../../electron/sqlite-service') as typeof import('../../electron/sqlite-service');

describe('sqlite-service', () => {
  // Initialize DB once — migration code consumes prepare mocks, so we do this once
  // and then reset only prepare between tests.
  beforeAll(() => {
    mockDb.prepare.mockImplementation(() => makeStmt());
    initializeDatabase();
  });

  beforeEach(() => {
    // Reset prepare and exec between tests (but keep the db initialized)
    mockDb.prepare.mockReset();
    mockDb.prepare.mockImplementation(() => makeStmt());
    mockDb.exec.mockReset();
    mockDb.pragma.mockReset();
  });

  describe('initializeDatabase', () => {
    test('enables WAL journal mode', () => {
      mockDb.prepare.mockImplementation(() => makeStmt());
      initializeDatabase();
      expect(mockDb.pragma).toHaveBeenCalledWith('journal_mode = WAL');
    });

    test('sets up NORMAL synchronous mode', () => {
      mockDb.prepare.mockImplementation(() => makeStmt());
      initializeDatabase();
      expect(mockDb.pragma).toHaveBeenCalledWith('synchronous = NORMAL');
    });

    test('enables foreign keys via PRAGMA', () => {
      mockDb.prepare.mockImplementation(() => makeStmt());
      initializeDatabase();
      expect(mockDb.exec).toHaveBeenCalledWith('PRAGMA foreign_keys = ON;');
    });
  });

  describe('getDb', () => {
    test('returns the database instance after initialization', () => {
      const db = getDb();
      expect(db).toBe(mockDb);
    });
  });

  describe('getCustomersPage', () => {
    test('aliases zipCode as zip in paginated customer queries', () => {
      mockDb.prepare
        .mockReturnValueOnce(makeStmt({ total: 1 }))
        .mockReturnValueOnce(makeStmt([{ id: 1, zip: '10115' }]));

      const result = getCustomersPage({ limit: 50 });

      expect(result.total).toBe(1);
      expect(mockDb.prepare.mock.calls[1][0]).toContain("COALESCE(zipCode, '') AS zip");
    });

    test('uses whitelisted global sort fields for paginated customers', () => {
      mockDb.prepare
        .mockReturnValueOnce(makeStmt({ total: 1 }))
        .mockReturnValueOnce(makeStmt([{ id: 1, email: 'kunde@example.com' }]));

      getCustomersPage({ limit: 50, sortBy: 'email', sortDirection: 'desc' });

      expect(mockDb.prepare.mock.calls[1][0]).toContain('ORDER BY email DESC, id ASC');
    });

    test('includes null status customers when filtering active customers', () => {
      mockDb.prepare
        .mockReturnValueOnce(makeStmt({ total: 1 }))
        .mockReturnValueOnce(makeStmt([{ id: 1, status: null }]));

      getCustomersPage({ limit: 50, status: 'Active' });

      expect(mockDb.prepare.mock.calls[0][0]).toContain('(status = @status OR status IS NULL)');
      expect(mockDb.prepare.mock.calls[1][0]).toContain('(status = @status OR status IS NULL)');
    });
  });

  describe('searchProducts', () => {
    test('honors product search limits above 100 up to the server cap', () => {
      const stmt = makeStmt([{ id: 1, name: 'Produkt' }]);
      mockDb.prepare.mockReturnValue(stmt);

      const result = searchProducts('', 200);

      expect(result).toHaveLength(1);
      expect(stmt.all).toHaveBeenCalledWith({ limit: 200 });
    });
  });

  describe('createTask validation', () => {
    test('rejects invalid customer ids without touching the database', () => {
      const result = createTask({ customer_id: 0, title: 'Follow up' });

      expect(result).toEqual({
        success: false,
        error: 'Bitte wählen Sie einen gültigen Kunden aus.',
      });
      expect(mockDb.prepare).not.toHaveBeenCalled();
    });

    test('rejects empty titles before customer lookup', () => {
      const result = createTask({ customer_id: 1, title: '   ' });

      expect(result).toEqual({
        success: false,
        error: 'Bitte geben Sie einen Aufgabentitel ein.',
      });
      expect(mockDb.prepare).not.toHaveBeenCalled();
    });

    test('rejects tasks for missing customers before inserting', () => {
      const customerStmt = makeStmt(undefined);
      mockDb.prepare.mockReturnValueOnce(customerStmt);

      const result = createTask({ customer_id: 99, title: 'Follow up' });

      expect(result).toEqual({
        success: false,
        error: 'Kunde 99 wurde nicht gefunden.',
      });
      expect(mockDb.prepare).toHaveBeenCalledTimes(1);
      expect(customerStmt.get).toHaveBeenCalledWith(99);
    });
  });

  describe('task and follow-up customer company projections', () => {
    test('projects a compatible customer display name and company for task lists', () => {
      const stmt = makeStmt([]);
      mockDb.prepare.mockReturnValue(stmt);

      getAllTasks(25, 0, { query: 'Meyer GmbH' });

      const sql = mockDb.prepare.mock.calls[0][0] as string;
      expect(sql).toContain("COALESCE(NULLIF(TRIM(c.name), ''), NULLIF(TRIM(c.firstName), ''), NULLIF(TRIM(c.company), '')) AS customer_name");
      expect(sql).toContain("NULLIF(TRIM(c.company), '') AS customer_company");
      expect(sql).toContain('c.firstName LIKE ?');
      expect(sql).toContain('c.company LIKE ?');
      expect(stmt.all).toHaveBeenCalledWith(
        '%Meyer GmbH%',
        '%Meyer GmbH%',
        '%Meyer GmbH%',
        '%Meyer GmbH%',
        '%Meyer GmbH%',
        25,
        0,
      );
    });

    test('projects customer company for task details and dashboard tasks', () => {
      mockDb.prepare.mockReturnValue(makeStmt({ id: 1 }));
      getTaskById(1);
      expect(mockDb.prepare.mock.calls[0][0]).toContain("NULLIF(TRIM(c.company), '') AS customer_company");

      mockDb.prepare.mockReset();
      mockDb.prepare.mockReturnValue(makeStmt([]));
      getUpcomingTasks(5);
      expect(mockDb.prepare.mock.calls[0][0]).toContain("NULLIF(TRIM(c.company), '') AS customer_company");

      mockDb.prepare.mockReset();
      mockDb.prepare.mockReturnValue(makeStmt([]));
      getTasksForCustomer(1);
      expect(mockDb.prepare.mock.calls[0][0]).toContain("NULLIF(TRIM(c.company), '') AS customer_company");

      mockDb.prepare.mockReset();
      mockDb.prepare.mockReturnValue(makeStmt([]));
      getTasksForDeal(1);
      expect(mockDb.prepare.mock.calls[0][0]).toContain("NULLIF(TRIM(c.company), '') AS customer_company");
    });

    test('projects and searches company data in follow-up queues', () => {
      const stmt = makeStmt([]);
      mockDb.prepare.mockReturnValue(stmt);

      getFollowUpItems('heute', { query: 'Meyer GmbH' }, 20, 0);

      const sql = mockDb.prepare.mock.calls[0][0] as string;
      expect(sql).toContain("NULLIF(TRIM(c.company), '') AS customer_company");
      expect(sql).toContain('c.firstName LIKE ?');
      expect(sql).toContain('c.company LIKE ?');
      expect(stmt.all).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        '%Meyer GmbH%',
        '%Meyer GmbH%',
        '%Meyer GmbH%',
        '%Meyer GmbH%',
        '%Meyer GmbH%',
        20,
        0,
      );
    });

    test('projects and searches company data in deal follow-up queues', () => {
      const stmt = makeStmt([]);
      mockDb.prepare.mockReturnValue(stmt);

      getFollowUpItems('stagnierende_deals', { query: 'Meyer GmbH' }, 20, 0);

      const sql = mockDb.prepare.mock.calls[0][0] as string;
      expect(sql).toContain("NULLIF(TRIM(c.company), '') AS customer_company");
      expect(sql).toContain('c.firstName LIKE ?');
      expect(sql).toContain('c.company LIKE ?');
      expect(stmt.all).toHaveBeenCalledWith(
        expect.any(String),
        '%Meyer GmbH%',
        '%Meyer GmbH%',
        '%Meyer GmbH%',
        '%Meyer GmbH%',
        20,
        0,
      );
    });
  });

  describe('getSyncInfo', () => {
    test('returns value for existing key', () => {
      mockDb.prepare.mockReturnValue(makeStmt({ value: '2026-03-01' }));

      const result = getSyncInfo('lastSyncTimestamp');
      expect(result).toBe('2026-03-01');
    });

    test('returns null when key does not exist', () => {
      mockDb.prepare.mockReturnValue(makeStmt(undefined));

      const result = getSyncInfo('nonExistentKey');
      expect(result).toBeNull();
    });
  });

  describe('setSyncInfo', () => {
    test('calls prepare and run with key and value', () => {
      const stmt = makeStmt();
      mockDb.prepare.mockReturnValue(stmt);

      setSyncInfo('lastSyncStatus', 'Success');

      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO sync_info'));
      expect(stmt.run).toHaveBeenCalledWith('lastSyncStatus', 'Success');
    });
  });

  describe('getAllCustomFields', () => {
    test('returns all custom fields', () => {
      const fields = [
        { id: 1, name: 'company_type', label: 'Company Type', type: 'text' },
        { id: 2, name: 'vat_id', label: 'VAT ID', type: 'text' },
      ];
      mockDb.prepare.mockReturnValue(makeStmt(fields));

      const result = getAllCustomFields();
      expect(result).toEqual(fields);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM customer_custom_fields')
      );
    });

    test('returns empty array when no fields exist', () => {
      mockDb.prepare.mockReturnValue(makeStmt([]));

      const result = getAllCustomFields();
      expect(result).toEqual([]);
    });
  });

  describe('getActiveCustomFields', () => {
    test('returns only active fields', () => {
      const activeFields = [{ id: 1, name: 'vat_id', active: 1 }];
      mockDb.prepare.mockReturnValue(makeStmt(activeFields));

      const result = getActiveCustomFields();
      expect(result).toEqual(activeFields);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('WHERE active = 1')
      );
    });
  });

  describe('getCustomFieldById', () => {
    test('returns field when found', () => {
      const field = { id: 5, name: 'notes', type: 'textarea' };
      const stmt = makeStmt(field);
      mockDb.prepare.mockReturnValue(stmt);

      const result = getCustomFieldById(5);
      expect(result).toEqual(field);
      expect(stmt.get).toHaveBeenCalledWith(5);
    });

    test('returns undefined when field not found', () => {
      mockDb.prepare.mockReturnValue(makeStmt(undefined));

      const result = getCustomFieldById(999);
      expect(result).toBeUndefined();
    });
  });

  describe('createCustomField', () => {
    test('inserts field and returns the created record', () => {
      const createdField = { id: 1, name: 'notes', label: 'Notes', type: 'textarea', active: 1 };
      const insertStmt = { run: jest.fn(() => ({ lastInsertRowid: 1 })), all: jest.fn(), get: jest.fn() };
      const selectStmt = makeStmt(createdField);

      // First call = INSERT, second call = SELECT by id
      mockDb.prepare.mockReturnValueOnce(insertStmt).mockReturnValueOnce(selectStmt);

      const result = createCustomField({
        name: 'notes',
        label: 'Notes',
        type: 'textarea',
        required: false,
        active: true,
      });

      expect(result).toEqual(createdField);
      expect(insertStmt.run).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'notes', required: 0, active: 1 })
      );
    });

    test('converts boolean required to integer', () => {
      const insertStmt = { run: jest.fn(() => ({ lastInsertRowid: 2 })), all: jest.fn(), get: jest.fn() };
      mockDb.prepare.mockReturnValueOnce(insertStmt).mockReturnValueOnce(makeStmt({ id: 2 }));

      createCustomField({ name: 'email', type: 'text', required: true });
      expect(insertStmt.run).toHaveBeenCalledWith(
        expect.objectContaining({ required: 1 })
      );
    });

    test('serializes options array to JSON string', () => {
      const insertStmt = { run: jest.fn(() => ({ lastInsertRowid: 3 })), all: jest.fn(), get: jest.fn() };
      mockDb.prepare.mockReturnValueOnce(insertStmt).mockReturnValueOnce(makeStmt({ id: 3 }));

      createCustomField({ name: 'status', type: 'select', options: ['A', 'B', 'C'] });
      expect(insertStmt.run).toHaveBeenCalledWith(
        expect.objectContaining({ options: '["A","B","C"]' })
      );
    });
  });

  describe('deleteCustomField', () => {
    test('deletes values first then the field and returns true', () => {
      const deleteValuesStmt = makeStmt();
      const deleteFieldStmt = { run: jest.fn(() => ({ changes: 1 })), all: jest.fn(), get: jest.fn() };
      mockDb.prepare
        .mockReturnValueOnce(deleteValuesStmt)
        .mockReturnValueOnce(deleteFieldStmt);

      const result = deleteCustomField(5);
      expect(result).toBe(true);
      expect(deleteValuesStmt.run).toHaveBeenCalledWith(5);
      expect(deleteFieldStmt.run).toHaveBeenCalledWith(5);
    });

    test('returns false when field does not exist', () => {
      const deleteValuesStmt = makeStmt();
      const deleteFieldStmt = { run: jest.fn(() => ({ changes: 0 })), all: jest.fn(), get: jest.fn() };
      mockDb.prepare
        .mockReturnValueOnce(deleteValuesStmt)
        .mockReturnValueOnce(deleteFieldStmt);

      const result = deleteCustomField(999);
      expect(result).toBe(false);
    });
  });

  describe('getCustomFieldValuesForCustomer', () => {
    test('returns joined custom field values for customer', () => {
      const values = [
        { id: 1, customer_id: 10, field_id: 1, value: 'GmbH', name: 'company_type', label: 'Company Type' },
      ];
      const stmt = makeStmt(values);
      mockDb.prepare.mockReturnValue(stmt);

      const result = getCustomFieldValuesForCustomer(10);
      expect(result).toEqual(values);
      expect(stmt.all).toHaveBeenCalledWith(10);
    });

    test('returns empty array when customer has no custom fields', () => {
      mockDb.prepare.mockReturnValue(makeStmt([]));

      const result = getCustomFieldValuesForCustomer(10);
      expect(result).toEqual([]);
    });
  });

  describe('deleteCustomFieldValue', () => {
    test('deletes value and returns true when found', () => {
      const stmt = { run: jest.fn(() => ({ changes: 1 })), all: jest.fn(), get: jest.fn() };
      mockDb.prepare.mockReturnValue(stmt);

      const result = deleteCustomFieldValue(10, 1);
      expect(result).toBe(true);
      expect(stmt.run).toHaveBeenCalledWith(10, 1);
    });

    test('returns false when value does not exist', () => {
      const stmt = { run: jest.fn(() => ({ changes: 0 })), all: jest.fn(), get: jest.fn() };
      mockDb.prepare.mockReturnValue(stmt);

      const result = deleteCustomFieldValue(999, 999);
      expect(result).toBe(false);
    });
  });
});
