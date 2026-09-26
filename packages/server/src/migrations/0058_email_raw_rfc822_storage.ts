import type { SqlMigration } from './types';

/**
 * Mail-Original platzsparend speichern (mail-raw-storage.ts).
 *
 * `raw_rfc822_z` hält das Original brotli-komprimiert (bytea statt base64-Text),
 * `raw_rfc822_sha256`/`raw_rfc822_size` beschreiben die ORIGINAL-Bytes; jedes
 * Lesen prüft sie. Codec 'br-parts': Anhangteile, die als Datei vorliegen,
 * sind aus dem gespeicherten Original herausgenommen und werden beim Lesen
 * byte-genau wieder eingesetzt; `raw_rfc822_part_sha256s` listet sie (GIN,
 * damit Aufräumen und DSGVO-Löschung prüfen können, ob ein Teil noch gebraucht
 * wird). STORAGE EXTERNAL: bereits komprimierte Daten nicht noch einmal
 * durch pglz schicken.
 *
 * `raw_rfc822_b64` bleibt für Altbestand lesbar; die Umstellung läuft als
 * Hintergrundjob in der Anwendung (FORCE RLS, siehe 0026), nicht hier.
 *
 * downSql entfernt nur die Prüfregeln und den Index, nicht die Spalten: ein
 * Zurücknehmen darf die komprimierten Originale nie löschen.
 */
export const emailRawRfc822StorageMigration: SqlMigration = {
  id: '0058_email_raw_rfc822_storage',
  description: 'Store the raw RFC 822 original compressed with hash, size and optional stripped attachment parts',
  upSql: [
    'ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS raw_rfc822_z bytea;',
    'ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS raw_rfc822_codec text;',
    'ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS raw_rfc822_sha256 text;',
    'ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS raw_rfc822_size bigint;',
    'ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS raw_rfc822_part_sha256s text[];',
    'ALTER TABLE email_messages ALTER COLUMN raw_rfc822_z SET STORAGE EXTERNAL;',
    `DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'email_messages_raw_rfc822_codec_check'
  ) THEN
    ALTER TABLE email_messages ADD CONSTRAINT email_messages_raw_rfc822_codec_check
      CHECK (raw_rfc822_codec IS NULL OR raw_rfc822_codec IN ('br', 'br-parts'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'email_messages_raw_rfc822_z_complete_check'
  ) THEN
    ALTER TABLE email_messages ADD CONSTRAINT email_messages_raw_rfc822_z_complete_check
      CHECK (
        raw_rfc822_z IS NULL
        OR (raw_rfc822_codec IS NOT NULL AND raw_rfc822_sha256 IS NOT NULL AND raw_rfc822_size IS NOT NULL)
      );
  END IF;
END $$;`,
    'CREATE INDEX IF NOT EXISTS email_messages_raw_rfc822_part_sha256s_gin_idx ON email_messages USING gin (raw_rfc822_part_sha256s) WHERE raw_rfc822_part_sha256s IS NOT NULL;',
  ],
  downSql: [
    'DROP INDEX IF EXISTS email_messages_raw_rfc822_part_sha256s_gin_idx;',
    'ALTER TABLE email_messages DROP CONSTRAINT IF EXISTS email_messages_raw_rfc822_z_complete_check;',
    'ALTER TABLE email_messages DROP CONSTRAINT IF EXISTS email_messages_raw_rfc822_codec_check;',
  ],
};
