import type { SqlMigration } from './types';

/**
 * Macht jtl_kkunde / jtl_kartikel pro Workspace eindeutig, damit der
 * Server-JTL-Sync ueber den JTL-Schluessel upserten kann (F-A10-01).
 *
 * Bisher schrieb der Sync kKunde/kArtikel in source_sqlite_id und upsertete
 * darauf. Aus der Desktop-Datenbank migrierte Zeilen tragen dort aber ihre
 * lokale Autoincrement-ID. Traf ein kKunde auf eine solche ID, ueberschrieb der
 * Sync den fremden Datensatz mit JTL-Stammdaten und setzte jtl_kkunde; der
 * eigentlich migrierte JTL-Datensatz blieb mit demselben jtl_kkunde stehen.
 *
 * Bereinigungsregel fuer solche Dubletten (gleicher Workspace, gleicher
 * JTL-Schluessel): Die Verknuepfung behaelt die Zeile, deren source_sqlite_id
 * vom JTL-Schluessel abweicht, denn nur der alte Sync hat beide gleichgesetzt;
 * eine abweichende ID heisst, der Link stammt aus der Desktop-Migration, wo
 * jtl_kKunde UNIQUE war. Bei Gleichstand gewinnt die kleinste id.
 *
 * Die uebrigen Zeilen werden NICHT geloescht oder zusammengefuehrt: Welche
 * Stammdaten zu welchen Deals, Aufgaben, Mails usw. gehoeren, laesst sich nicht
 * sicher entscheiden (der alte Sync hat migrierte lokale Kunden an Ort und Stelle
 * ueberschrieben), und Verweise auf Kunden gibt es in vielen Tabellen. Sie
 * verlieren nur die JTL-Verknuepfung und bleiben als lokale Datensaetze mit
 * allen Verweisen erhalten. Der entfernte Schluessel wird in
 * source_row.jtlLinkRemoved festgehalten, damit Betreiber die Faelle finden
 * (WHERE source_row ? 'jtlLinkRemoved'); die urspruenglichen Desktop-Daten
 * liegen weiter in sqlite_import_rows.
 *
 * Laeuft als Tabelleneigentuemer unter FORCE RLS: ohne den System-Kontext waere
 * das UPDATE ein stiller No-op. Idempotent: ohne Dubletten aendert das UPDATE
 * nichts, die Indizes werden nur angelegt, wenn sie fehlen.
 */
function unlinkDuplicateJtlKeysSql(table: 'customers' | 'products', column: 'jtl_kkunde' | 'jtl_kartikel', label: string): string {
  return `WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY workspace_id, ${column}
      ORDER BY (source_sqlite_id = ${column}) ASC, id ASC
    ) AS link_rank
  FROM ${table}
  WHERE ${column} IS NOT NULL
)
UPDATE ${table} AS target
SET
  source_row = target.source_row || jsonb_build_object(
    'jtlLinkRemoved',
    jsonb_build_object('${label}', target.${column}, 'migration', '0052_jtl_key_uniqueness')
  ),
  ${column} = NULL,
  updated_at = now()
FROM ranked
WHERE ranked.id = target.id
  AND ranked.link_rank > 1;`;
}

export const jtlKeyUniquenessMigration: SqlMigration = {
  id: '0052_jtl_key_uniqueness',
  description: 'Unlinks duplicate JTL keys and makes jtl_kkunde / jtl_kartikel unique per workspace for the JTL sync upsert.',
  upSql: [
    `SELECT set_config('app.role', 'system', true),
       set_config('app.cross_workspace_access', 'on', true);`,
    unlinkDuplicateJtlKeysSql('customers', 'jtl_kkunde', 'jtlKkunde'),
    unlinkDuplicateJtlKeysSql('products', 'jtl_kartikel', 'jtlKartikel'),
    `CREATE UNIQUE INDEX IF NOT EXISTS customers_workspace_jtl_kkunde_unique_idx
  ON customers (workspace_id, jtl_kkunde)
  WHERE jtl_kkunde IS NOT NULL;`,
    `CREATE UNIQUE INDEX IF NOT EXISTS products_workspace_jtl_kartikel_unique_idx
  ON products (workspace_id, jtl_kartikel)
  WHERE jtl_kartikel IS NOT NULL;`,
  ],
  // Nur die Indizes fallen weg; die entfernten Dubletten-Verknuepfungen bleiben
  // entfernt, weil ihr Zuruecksetzen die Kollision wiederherstellen wuerde.
  downSql: [
    'DROP INDEX IF EXISTS products_workspace_jtl_kartikel_unique_idx;',
    'DROP INDEX IF EXISTS customers_workspace_jtl_kkunde_unique_idx;',
  ],
};
