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
    const start = src.indexOf('if (!dbExists)');
    const end = src.indexOf('} else {', start);
    return start >= 0 && end > start ? src.slice(start, end) : '';
  })();

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
});
