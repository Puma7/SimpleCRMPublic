const mockStoreGet = jest.fn()
const mockKeytarGetPassword = jest.fn()
const mockConnect = jest.fn()
const mockClose = jest.fn()
const mockQuery = jest.fn()
const mockConnectionPoolConstructors: unknown[] = []

jest.mock('electron-store', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    get: mockStoreGet,
    set: jest.fn(),
    delete: jest.fn(),
  })),
}))

jest.mock('keytar', () => ({
  __esModule: true,
  default: {
    getPassword: mockKeytarGetPassword,
    setPassword: jest.fn(),
    deletePassword: jest.fn(),
  },
}))

jest.mock('mssql', () => ({
  __esModule: true,
  default: {
    ConnectionPool: jest.fn().mockImplementation(function MockConnectionPool(this: { connected: boolean }) {
      this.connected = false
      mockConnectionPoolConstructors.push(this)
      return {
        get connected() {
          return this._connected === true
        },
        set connected(value: boolean) {
          this._connected = value
        },
        connect: mockConnect.mockImplementation(async function connect(this: { connected: boolean }) {
          this.connected = true
          return this
        }),
        close: mockClose,
        on: jest.fn(),
        request: () => ({ query: mockQuery }),
      }
    }),
    Request: jest.fn(),
    Transaction: jest.fn(),
  },
}))

describe('mssql keytar connection pool', () => {
  beforeEach(() => {
    jest.resetModules()
    mockStoreGet.mockReset()
    mockKeytarGetPassword.mockReset()
    mockConnect.mockClear()
    mockClose.mockReset()
    mockQuery.mockReset()
    mockConnectionPoolConstructors.length = 0

    mockStoreGet.mockReturnValue({
      server: 'localhost',
      port: 1433,
      database: 'eazybusiness',
      user: 'JTLSQLBI',
      encrypt: true,
      trustServerCertificate: true,
      forcePort: false,
    })
    mockKeytarGetPassword.mockResolvedValue('secret')
    mockQuery.mockResolvedValue({ recordset: [] })
  })

  it('shares one connection attempt across parallel JTL fetches', async () => {
    const service = await import('../../electron/mssql-keytar-service')

    await Promise.all([
      service.fetchJtlProducts(),
      service.fetchJtlFirmen(),
    ])

    expect(mockConnectionPoolConstructors).toHaveLength(1)
    expect(mockConnect).toHaveBeenCalledTimes(1)
    expect(mockQuery).toHaveBeenCalledTimes(2)
  })

  // C-C11: executeReadOnlyMssqlQuery sent any text to the JTL database; only its length was checked.
  it('refuses writing batches before querying and runs only the checked text', async () => {
    const service = await import('../../electron/mssql-keytar-service')

    await expect(service.executeReadOnlyMssqlQuery('SELECT * INTO dbo.pwned FROM dbo.tKunde')).resolves.toEqual({
      success: false,
      error: 'Nur lesende SELECT-Abfragen sind erlaubt',
    })
    await expect(service.executeReadOnlyMssqlQuery('SELECT 1; DISABLE TRIGGER ALL ON dbo.tKunde')).resolves.toEqual({
      success: false,
      error: 'Nur lesende SELECT-Abfragen sind erlaubt',
    })
    expect(mockQuery).not.toHaveBeenCalled()

    mockQuery.mockResolvedValue({ recordset: [{ ok: 1 }] })
    await expect(service.executeReadOnlyMssqlQuery('-- Test\nSELECT 1 AS ok')).resolves.toEqual({
      success: true,
      rows: [{ ok: 1 }],
      rowCount: 1,
    })
    expect(mockQuery).toHaveBeenCalledWith('SELECT 1 AS ok')
  })
})
