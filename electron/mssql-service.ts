import sql from 'mssql';
import { MssqlSettings, MssqlError } from './types';

// Define the schema type explicitly
type MssqlStoreSchema = {
    mssqlSettings: MssqlSettings | null;
};

type MssqlStore = {
    get(key: 'mssqlSettings'): MssqlSettings | null;
    set(key: 'mssqlSettings', value: MssqlSettings | null): void;
};

let storePromise: Promise<MssqlStore> | undefined;

function getStore(): Promise<MssqlStore> {
    storePromise ??= import('electron-store').then(({ default: Store }) => (
        new Store<MssqlStoreSchema>({
            defaults: {
                mssqlSettings: null,
            },
        })
    ));
    return storePromise;
}

let pool: sql.ConnectionPool | null = null;

export async function saveMssqlSettings(settings: MssqlSettings): Promise<void> {
    const store = await getStore();
    store.set('mssqlSettings', settings);
}

export async function getMssqlSettings(): Promise<MssqlSettings | null> {
    const store = await getStore();
    return store.get('mssqlSettings');
}

export async function testConnection(settings: MssqlSettings): Promise<boolean> {
    const testPool = new sql.ConnectionPool({
        user: settings.user,
        password: settings.password,
        database: settings.database,
        server: settings.server,
        port: settings.port,
        options: {
            encrypt: settings.encrypt,
            trustServerCertificate: settings.trustServerCertificate
        }
    });

    try {
        await testPool.connect();
        await testPool.close();
        return true;
    } catch (error) {
        console.error('Connection test failed:', error);
        return false;
    }
}

async function getConnectionPool(): Promise<sql.ConnectionPool> {
    if (pool && pool.connected) {
        return pool;
    }

    const settings = await getMssqlSettings();
    if (!settings) {
        throw new Error('MSSQL settings not configured');
    }

    try {
        pool = await new sql.ConnectionPool({
            user: settings.user,
            password: settings.password,
            database: settings.database,
            server: settings.server,
            port: settings.port,
            options: {
                encrypt: settings.encrypt,
                trustServerCertificate: settings.trustServerCertificate
            }
        }).connect();

        pool.on('error', err => {
            console.error('Pool error:', err);
            pool?.close();
            pool = null;
        });

        return pool;
    } catch (error) {
        console.error('Failed to create connection pool:', error);
        throw error;
    }
}

export async function fetchCustomers() {
    try {
        const pool = await getConnectionPool();
        const result = await pool.request().query(`
            SELECT 
                k.kKunde,
                k.dErstellt,
                k.cSperre,
                a.cFirma,
                a.cVorname,
                a.cName,
                a.cStrasse,
                a.cPLZ,
                a.cOrt,
                a.cLand,
                a.cTel,
                a.cMobil,
                a.cMail
            FROM dbo.tKunde k
            LEFT JOIN dbo.tAdresse a ON k.kKunde = a.kKunde AND a.nStandard = 1
            ORDER BY a.cName, a.cVorname;
        `);
        
        return result.recordset;
    } catch (error) {
        console.error('Error fetching customers:', error);
        throw error;
    }
}

export async function closeMssqlPool(): Promise<void> {
    if (pool) {
        try {
            await pool.close();
            pool = null;
        } catch (error) {
            console.error('Error closing pool:', error);
            throw error;
        }
    }
}
