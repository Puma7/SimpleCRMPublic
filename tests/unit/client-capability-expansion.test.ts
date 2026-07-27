import { expandUserGroupCapabilities } from '@shared/user-capabilities';
import { expandUserGroupCapabilities as serverExpand } from '../../packages/server/src/api/capabilities';

/**
 * Der Server expandiert in requireCapability defensiv ("tests and tokens may
 * store only the highest key"), der Client verglich bis zu dieser Aenderung nur
 * exakte Strings. Gespeichert wird pro Modul aber NUR die hoechste Stufe
 * (normalizeStoredUserGroupPermissions), und `email_settings.manage` ist ein
 * akzeptiertes Legacy-Alias. Ohne dieselbe Expansion im Client haette ein
 * crm.write-Inhaber kein crm.read — und seit die Navigation danach gefiltert
 * wird, verschwaende ihm die Oberflaeche, statt nur ein 403 zu kassieren.
 */
describe('client capability expansion', () => {
  const gates = (granted: readonly string[]) => {
    const expanded = expandUserGroupCapabilities(granted);
    return {
      canReadCrm: expanded.includes('crm.read'),
      canWriteCrm: expanded.includes('crm.write'),
      canViewWorkflows: expanded.includes('workflows.view'),
      canViewSettings: expanded.includes('settings.view'),
      canManageSettings: expanded.includes('settings.manage'),
    };
  };

  test('a compact crm.write grant still opens the read gates', () => {
    expect(gates(['crm.write'])).toEqual({
      canReadCrm: true,
      canWriteCrm: true,
      canViewWorkflows: false,
      canViewSettings: false,
      canManageSettings: false,
    });
  });

  test('workflows.manage implies the lower workflow levels', () => {
    expect(gates(['workflows.manage']).canViewWorkflows).toBe(true);
  });

  test('the legacy email_settings.manage alias opens both settings gates', () => {
    expect(gates(['email_settings.manage'])).toMatchObject({
      canViewSettings: true,
      canManageSettings: true,
    });
  });

  test('an empty grant list opens nothing', () => {
    expect(gates([])).toEqual({
      canReadCrm: false,
      canWriteCrm: false,
      canViewWorkflows: false,
      canViewSettings: false,
      canManageSettings: false,
    });
  });

  test('client and server expansion stay identical', () => {
    // Driften sie auseinander, sperrt die UI genau die Nutzer aus, die der
    // Server durchlaesst (oder — schlimmer — zeigt Bereiche, die 403 liefern).
    for (const granted of [
      [],
      ['crm.read'],
      ['crm.write'],
      ['workflows.run'],
      ['workflows.manage'],
      ['settings.view'],
      ['email_settings.manage'],
      ['tracking.view'],
      ['users.manage'],
      ['crm.write', 'workflows.edit', 'email_settings.manage'],
      ['unbekannt.key'],
    ]) {
      expect({ granted, expanded: expandUserGroupCapabilities(granted) })
        .toEqual({ granted, expanded: serverExpand(granted) });
    }
  });
});
