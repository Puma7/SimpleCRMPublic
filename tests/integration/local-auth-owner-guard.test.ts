/**
 * @jest-environment node
 */
jest.mock('electron', () => ({
  app: { getPath: () => `${process.cwd()}/.tmp-tests/simplecrm-local-auth-owner-guard` },
}));

import Database from 'better-sqlite3';
import { bootstrapFreshDatabaseSchema, closeDatabase } from '../../electron/sqlite-service';
import { LOCAL_OWNER_USER_ID } from '../../electron/mail-roadmap-migrations';
import { saveLocalAuthUser } from '../../electron/auth/auth-store';

// C-A72: Auf dem Desktop konnte SaveUser den letzten aktiven Owner zum Admin herabstufen oder
// deaktivieren; danach waren Restore und Hard-Reset (nur Owner) fuer niemanden mehr erreichbar.
describe('saveLocalAuthUser erhaelt den letzten aktiven Owner', () => {
  let db: Database.Database;

  const userRow = (id: string) =>
    db.prepare('SELECT role, is_active, password_hash FROM users WHERE id = ?').get(id) as {
      role: string;
      is_active: number;
      password_hash: string;
    };

  const createUser = (username: string, role: 'owner' | 'admin') => {
    const result = saveLocalAuthUser({ username, displayName: username, role, passphrase: 'Passwort-1234567' });
    if (!result.success || !result.id) throw new Error('Benutzer konnte nicht angelegt werden');
    return result.id;
  };

  beforeEach(() => {
    db = new Database(':memory:');
    bootstrapFreshDatabaseSchema(db, { keepDbAssigned: true });
    // Der Bootstrap legt local-owner als einzigen aktiven Owner an.
    createUser('admin', 'admin');
  });

  afterEach(() => {
    closeDatabase();
  });

  test.each([
    ['herabstufen', { role: 'admin' as const }],
    ['deaktivieren', { role: 'owner' as const, isActive: false }],
  ])('der einzige aktive Owner laesst sich nicht %s', (_label, change) => {
    const before = userRow(LOCAL_OWNER_USER_ID);

    const result = saveLocalAuthUser({
      id: LOCAL_OWNER_USER_ID,
      username: 'owner',
      displayName: 'Owner',
      passphrase: 'Neues-Passwort-123',
      ...change,
    });

    expect(result).toEqual({ success: false, error: 'Mindestens ein aktiver Eigentümer muss bestehen bleiben' });
    expect(userRow(LOCAL_OWNER_USER_ID)).toEqual(before);
  });

  test('ein deaktivierter zweiter Owner zaehlt nicht', () => {
    const secondOwner = createUser('owner2', 'owner');
    db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(secondOwner);

    const result = saveLocalAuthUser({ id: LOCAL_OWNER_USER_ID, username: 'owner', displayName: 'Owner', role: 'admin' });

    expect(result.success).toBe(false);
    expect(userRow(LOCAL_OWNER_USER_ID).role).toBe('owner');
  });

  test('der einzige Owner bleibt als Owner bearbeitbar', () => {
    const result = saveLocalAuthUser({
      id: LOCAL_OWNER_USER_ID,
      username: 'owner',
      displayName: 'Umbenannt',
      role: 'owner',
      isActive: true,
    });

    expect(result).toEqual({ success: true, id: LOCAL_OWNER_USER_ID });
  });

  test('mit einem weiteren aktiven Owner sind Herabstufen und Deaktivieren moeglich', () => {
    const secondOwner = createUser('owner2', 'owner');

    expect(saveLocalAuthUser({ id: LOCAL_OWNER_USER_ID, username: 'owner', displayName: 'Owner', role: 'admin' }))
      .toEqual({ success: true, id: LOCAL_OWNER_USER_ID });
    expect(userRow(LOCAL_OWNER_USER_ID).role).toBe('admin');

    // Jetzt ist owner2 der letzte aktive Owner.
    expect(saveLocalAuthUser({ id: secondOwner, username: 'owner2', displayName: 'owner2', role: 'owner', isActive: false }))
      .toMatchObject({ success: false });
    expect(userRow(secondOwner)).toMatchObject({ role: 'owner', is_active: 1 });
  });
});
