import { normalizedMessageIdSql } from '../../packages/server/src/db/mail-thread-normalization-sql';
import { emailMessageThreadLookupMigration } from '../../packages/server/src/migrations/0025_email_message_thread_lookup';

/**
 * The sync resolver query builds its normalized Message-ID / In-Reply-To
 * expression from normalizedMessageIdSql(), while migration 0025 carries the
 * SAME expression as FROZEN literal SQL (its checksum must never change). This
 * test is the tripwire that keeps the two in lockstep: if someone edits the
 * helper, this fails — signalling that a NEW migration+index is required rather
 * than editing the already-checksummed 0025.
 */
describe('normalizedMessageIdSql parity with migration 0025', () => {
  const upSql = emailMessageThreadLookupMigration.upSql.join('\n');

  test('helper output matches the frozen index expression for message_id', () => {
    expect(upSql).toContain(normalizedMessageIdSql('message_id'));
  });

  test('helper output matches the frozen index expression for in_reply_to', () => {
    expect(upSql).toContain(normalizedMessageIdSql('in_reply_to'));
  });

  test('strips only a single outer angle-bracket pair (mirrors normalizeMessageId)', () => {
    // Documents the exact SQL so a normalization change is a conscious edit.
    expect(normalizedMessageIdSql('message_id')).toBe(
      "lower(regexp_replace(regexp_replace(btrim(coalesce(message_id, '')), '^<', ''), '>$', ''))",
    );
  });
});
