import fs from 'fs';
import path from 'path';

/**
 * Contract test: fresh DB init must call the same migration path as upgraded DBs.
 * (Full integration needs Electron-linked better-sqlite3; mail jest uses Node.)
 */
describe('sqlite fresh mail schema contract', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../electron/sqlite-service.ts'),
    'utf8',
  );

  const freshBlock = (() => {
    const marker = 'export function bootstrapFreshDatabaseSchema';
    const start = src.indexOf(marker);
    if (start < 0) return '';
    const bodyStart = src.indexOf('): void {', start);
    if (bodyStart < 0) return '';
    const open = bodyStart + '): void '.length;
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') depth += 1;
      if (src[i] === '}') {
        depth -= 1;
        if (depth === 0) return src.slice(open, i + 1);
      }
    }
    return '';
  })();

  test('bootstrapFreshDatabaseSchema exists', () => {
    expect(freshBlock.length).toBeGreaterThan(100);
  });

  test('fresh init creates email_ai_profiles before prompts', () => {
    const profilesIdx = freshBlock.indexOf('createEmailAiProfilesTable');
    const promptsIdx = freshBlock.indexOf('createEmailAiPromptsTable');
    expect(profilesIdx).toBeGreaterThan(-1);
    expect(promptsIdx).toBeGreaterThan(-1);
    expect(profilesIdx).toBeLessThan(promptsIdx);
  });

  test('fresh init runs runMigrations after base tables', () => {
    expect(freshBlock).toContain('runMigrations()');
    const migrationsIdx = freshBlock.indexOf('runMigrations()');
    const messagesIdx = freshBlock.indexOf('createEmailMessagesTable');
    expect(migrationsIdx).toBeGreaterThan(messagesIdx);
  });

  test('fresh init runs FTS setup after runMigrations', () => {
    const migrationsIdx = freshBlock.indexOf('runMigrations()');
    const ftsIdx = freshBlock.indexOf('setupEmailFtsIndex()');
    expect(ftsIdx).toBeGreaterThan(migrationsIdx);
  });
});
