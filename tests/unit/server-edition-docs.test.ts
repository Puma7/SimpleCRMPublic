import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const repoRoot = join(__dirname, '..', '..');

const readRepoFile = (path: string) => readFileSync(join(repoRoot, path), 'utf8');

describe('server edition AP-12 operator docs', () => {
  const docs = [
    'docs/SETUP_LOCAL.md',
    'docs/SETUP_SERVER.md',
    'docs/MIGRATION_STANDALONE_TO_SERVER.md',
    'docs/BACKUP_AND_RESTORE.md',
    'docs/THREAT_MODEL.md',
  ];

  test('publishes all required AP-12 documents in the documentation index', () => {
    const index = readRepoFile('docs/INDEX.md');

    for (const doc of docs) {
      expect(existsSync(join(repoRoot, doc))).toBe(true);
      expect(index).toContain(`[${doc.replace('docs/', '')}](${doc.replace('docs/', '')})`);
    }
  });

  test('documents local, server, migration, backup, restore, and threat-model flows', () => {
    expect(readRepoFile('docs/SETUP_LOCAL.md')).toEqual(expect.stringContaining('npm run test:server-edition'));
    expect(readRepoFile('docs/SETUP_SERVER.md')).toEqual(expect.stringContaining('docker compose up -d --build'));
    expect(readRepoFile('docs/SETUP_SERVER.md')).toEqual(expect.stringContaining('sh ./simplecrm up'));
    expect(readRepoFile('docs/SETUP_SERVER.md')).toEqual(expect.stringContaining('sh ./simplecrm ps'));
    expect(readRepoFile('docs/SETUP_SERVER.md')).toEqual(expect.stringContaining('sh ./simplecrm logs api caddy'));
    expect(readRepoFile('docs/SETUP_SERVER.md')).toEqual(expect.stringContaining('npm run doctor:server'));
    expect(readRepoFile('docs/SETUP_SERVER.md')).toEqual(expect.stringContaining('JSON access logs in the `caddy_logs` volume'));
    expect(readRepoFile('docs/SETUP_SERVER.md')).toEqual(expect.stringContaining('docker compose --profile minio up -d minio'));
    expect(readRepoFile('docs/SETUP_SERVER.md')).toEqual(expect.stringContaining('docker compose --profile monitor up -d monitor'));
    expect(readRepoFile('docs/SETUP_SERVER.md')).toEqual(expect.stringContaining('docker compose --profile pgadmin up -d pgadmin'));
    expect(readRepoFile('docs/SETUP_SERVER.md')).toEqual(expect.stringContaining('127.0.0.1'));

    const migration = readRepoFile('docs/MIGRATION_STANDALONE_TO_SERVER.md');
    expect(migration).toEqual(expect.stringContaining('npm run migrate:standalone-to-server'));
    expect(migration).toEqual(expect.stringContaining('pg_restore --clean --if-exists --no-owner'));

    const backup = readRepoFile('docs/BACKUP_AND_RESTORE.md');
    expect(backup).toEqual(expect.stringContaining('sh ./simplecrm backup'));
    expect(backup).toEqual(expect.stringContaining('sh ./simplecrm backup-scheduler'));
    expect(backup).toEqual(expect.stringContaining('sh ./simplecrm doctor'));
    expect(backup).toEqual(expect.stringContaining('sh ./simplecrm restore'));
    expect(backup).toEqual(expect.stringContaining('sh ./simplecrm restore-drill'));
    expect(backup).toEqual(expect.stringContaining('docker compose --profile backup run --rm backup'));
    expect(backup).toEqual(expect.stringContaining('docker compose --profile restore-drill run --rm restore-drill'));
    expect(backup).toEqual(expect.stringContaining('7 daily + 4 weekly + 12 monthly'));
    expect(backup).toEqual(expect.stringContaining('BACKUP_RETENTION_DAILY'));
    expect(backup).toEqual(expect.stringContaining('BACKUP_RETENTION_WEEKLY'));
    expect(backup).toEqual(expect.stringContaining('BACKUP_RETENTION_MONTHLY'));
    // Die gefaehrlichste Luecke eines Backups ist die, von der der Betrieb
    // nichts weiss: der Master-Key liegt NICHT im Backup, und ohne ihn ist ein
    // technisch einwandfreier Dump fuer jedes Secret wertlos.
    expect(backup).toEqual(expect.stringContaining('What The Backup Does **Not** Contain'));
    expect(backup).toEqual(expect.stringContaining('SIMPLECRM_MASTER_KEY'));
    expect(backup).toEqual(expect.stringContaining('Keep a copy of `docker/.env` **outside** the backup volume'));
    // Rollback: --clean loescht nur, was im Dump steht.
    expect(backup).toEqual(expect.stringContaining('Rolling Back To An Earlier Backup'));
    expect(backup).toEqual(expect.stringContaining('only drops what the dump knows about'));

    const threatModel = readRepoFile('docs/THREAT_MODEL.md');
    expect(threatModel).toEqual(expect.stringContaining('Invalid `Authorization` headers must not fall back'));
    expect(threatModel).toEqual(expect.stringContaining('forced PostgreSQL RLS'));
  });

  test('documents the required Docker environment contract', () => {
    const envExample = readRepoFile('docker/.env.example');
    const gitignore = readRepoFile('.gitignore');

    expect(envExample).toEqual(expect.stringContaining("require('crypto').randomBytes(32).toString('base64')"));
    expect(envExample).toEqual(expect.stringContaining('PG_PASSWORD='));
    expect(envExample).toEqual(expect.stringContaining('MASTER_KEY='));
    expect(envExample).toEqual(expect.stringContaining('ACCESS_TOKEN_SECRET='));
    expect(envExample).toEqual(expect.stringContaining('PUBLIC_BASE_URL='));
    expect(envExample).toEqual(expect.stringContaining('CORS_ALLOWED_ORIGINS='));
    expect(envExample).toEqual(expect.stringContaining('BACKUP_RETENTION_DAILY=7'));
    expect(envExample).toEqual(expect.stringContaining('BACKUP_RETENTION_WEEKLY=4'));
    expect(envExample).toEqual(expect.stringContaining('BACKUP_RETENTION_MONTHLY=12'));
    expect(envExample).toEqual(expect.stringContaining('MINIO_ROOT_PASSWORD=CHANGE_ME_minio_root_password'));
    expect(envExample).toEqual(expect.stringContaining('UPTIME_KUMA_BIND=127.0.0.1'));
    expect(envExample).toEqual(expect.stringContaining('PGADMIN_DEFAULT_PASSWORD=CHANGE_ME_pgadmin_password'));
    expect(envExample).toEqual(expect.stringContaining('MASTER_KEY must decode to exactly 32 bytes'));
    expect(envExample).toEqual(expect.stringContaining('ACCESS_TOKEN_SECRET must decode to at least 32 bytes'));
    expect(gitignore).toEqual(expect.stringContaining('!docker/.env.example'));
  });

  test('keeps AP-12 server documentation files trackable despite the markdown ignore rule', () => {
    const gitignore = readRepoFile('.gitignore');

    for (const doc of docs) {
      expect(gitignore).toEqual(expect.stringContaining(`!${doc}`));
    }
  });

  test('documents generation-based Docker backup retention', () => {
    const compose = readRepoFile('docker/docker-compose.yml');
    const backup = readRepoFile('docker/backup.sh');
    const retention = readRepoFile('docker/backup-retention.sh');

    expect(compose).toEqual(expect.stringContaining('./backup-retention.sh:/app/backup-retention.sh:ro'));
    expect(compose).toEqual(expect.stringContaining('BACKUP_RETENTION_DAILY: ${BACKUP_RETENTION_DAILY:-7}'));
    expect(compose).toEqual(expect.stringContaining('BACKUP_RETENTION_WEEKLY: ${BACKUP_RETENTION_WEEKLY:-4}'));
    expect(compose).toEqual(expect.stringContaining('BACKUP_RETENTION_MONTHLY: ${BACKUP_RETENTION_MONTHLY:-12}'));
    expect(backup).toEqual(expect.stringContaining('. "$SCRIPT_DIR/backup-retention.sh"'));
    expect(backup).toEqual(expect.stringContaining('prune_backup_retention "$BACKUP_DIR"'));
    expect(retention).toEqual(expect.stringContaining('select_retained_backup_stamps'));
    expect(retention).toEqual(expect.stringContaining('daily_count < daily'));
    expect(retention).toEqual(expect.stringContaining('weekly_count < weekly'));
    expect(retention).toEqual(expect.stringContaining('monthly_count < monthly'));
    // Die Metadatei gehoert zum Backup-Satz: mitschreiben, mitpruefen,
    // mitloeschen. Ohne den Aufraeumpfad blieben .meta-Dateien fuer immer
    // liegen, waehrend ihr Dump laengst rotiert ist.
    expect(backup).toEqual(expect.stringContaining('write_backup_metadata "$DATABASE_URL" "$BACKUP_DIR" "$STAMP"'));
    expect(backup).toEqual(expect.stringContaining('sha256sum "$METADATA_FILE" >> "$CHECKSUM_MANIFEST"'));
    expect(retention).toEqual(expect.stringContaining('"$backup_dir/backup-$stamp.meta"'));
    expect(retention).toEqual(expect.stringContaining('"$backup_dir"/backup-*.meta'));
  });

  test('backup metadata turns a finished restore into a verified one', () => {
    const metadata = readRepoFile('docker/backup-metadata.sh');
    const backup = readRepoFile('docker/backup.sh');
    const restore = readRepoFile('docker/restore.sh');
    const drill = readRepoFile('docker/restore-drill.sh');
    const doctor = readRepoFile('docker/doctor.sh');
    const compose = readRepoFile('docker/docker-compose.yml');

    // Nur die Schluessel-KENNUNG wandert ins Backup, nie der Schluessel.
    expect(metadata).toEqual(expect.stringContaining('string_agg(DISTINCT key_id'));
    expect(metadata).not.toEqual(expect.stringContaining('SIMPLECRM_MASTER_KEY='));
    // Fehlende Tabellen duerfen ein Backup nicht verhindern.
    expect(metadata).toEqual(expect.stringContaining("to_regclass('public.$2') IS NULL"));
    // Die Tabellenliste kommt aus dem Katalog, nicht aus dieser Datei. Eine
    // handgepflegte Liste war schon in der ersten Fassung unvollstaendig —
    // ausgerechnet customers, deals, products und returns fehlten, also die
    // Tabellen mit dem eigentlichen geschaeftlichen Wert. Ueber neunzig
    // Tabellen tragen FORCE ROW LEVEL SECURITY; jede neue kaeme sonst still
    // wieder abhanden.
    expect(metadata).toEqual(expect.stringContaining('AND c.relrowsecurity'));
    expect(metadata).not.toMatch(/BACKUP_METADATA_TABLES=/);
    // Und geprueft wird ueber die Tabellen, die IM BACKUP stehen.
    expect(metadata).toEqual(expect.stringContaining("awk -F= '/^rows_/"));
    // Nicht lesbar ist nicht dasselbe wie in Ordnung: fehlt die Tabelle nach der
    // Wiederherstellung oder scheitert die Abfrage, wurde die Vollstaendigkeit
    // NICHT geprueft — das als Erfolg zu melden waere die schlimmere Variante.
    expect(metadata).toEqual(expect.stringContaining('cannot read $table after restore'));
    // Scheitert die Katalog-Abfrage, entstuende sonst eine Metadatei ohne
    // rows_-Eintraege: die Pruefung liefe ueber null Tabellen und meldete
    // Erfolg — die Verifikation waere lautlos verschwunden. Die Datei sagt
    // jetzt selbst, dass sie unvollstaendig ist, und der Restore verweigert
    // daraufhin die Erfolgsmeldung.
    expect(metadata).toEqual(expect.stringContaining("rows_recorded='failed'"));
    expect(metadata).toEqual(expect.stringContaining('this backup carries no row counts'));
    expect(metadata).not.toMatch(/BACKUP_METADATA_COUNT_SQL" 2>\/dev\/null \|\| true/);
    // Und eine im Manifest gelistete, aber fehlende Metadatei bricht ab; nur
    // Backups von vor dieser Aenderung duerfen ungeprueft durchlaufen.
    expect(metadata).toEqual(expect.stringContaining('backup_metadata_is_listed()'));
    for (const script of [restore, drill]) {
      expect(script).toEqual(expect.stringContaining('is listed in the checksum manifest but missing'));
    }

    // pg_restore meldet nur "keine Fehler". Erst der Abgleich der Zeilenzahlen
    // belegt Vollstaendigkeit — eine unter zu schwachen Rechten gezogene
    // Sicherung stellt sich sonst sauber, aber halb leer wieder her.
    // Gezaehlt wird VOR dem Dump — danach faenge die Zahl auch die Schreibvorgaenge
    // waehrend der Dump-Laufzeit ein (Gatekeeper-Befund zu #183).
    expect(backup).toMatch(
      /write_backup_metadata "\$DATABASE_URL" "\$BACKUP_DIR" "\$STAMP"[\s\S]*?pg_dump -Fc/,
    );
    // Und die Pruefung ist bewusst KEINE Gleichheitsprobe: zwischen Zaehlung und
    // Snapshot duerfen Zeilen dazukommen. Alarm nur fuer den Fall, der nicht
    // harmlos entstehen kann — Backup hatte Zeilen, Restore hat keine.
    // Eine leere Tabelle warnt, bricht aber NICHT ab: wird die letzte Zeile
    // zwischen Zaehlung und Dump-Snapshot geloescht, ist genau das rechtmaessig.
    expect(metadata).toEqual(expect.stringContaining('WARNING — $table is empty after restore'));
    // Die Schluessel-Kennung ist eine Erinnerung, keine Pruefung — der Server
    // vergibt sie ohne Argument, sie lautet ueberall 'default'.
    expect(metadata).toEqual(expect.stringContaining('NOT proof of a matching key'));
    expect(metadata).toEqual(expect.stringContaining('writes between count and dump are expected'));
    // Die Ursache des stillen Fehlerfalls ist beim Backup direkt pruefbar.
    expect(metadata).toEqual(expect.stringContaining('SELECT (rolsuper OR rolbypassrls)'));
    expect(metadata).toEqual(expect.stringContaining('refusing to back up'));
    expect(backup).toEqual(expect.stringContaining('assert_backup_role_reads_all_rows "$DATABASE_URL"'));
    expect(restore).toEqual(expect.stringContaining("verify_backup_metadata \"$METADATA_PATH\" \"$DATABASE_URL\" 'restore'"));
    expect(drill).toEqual(expect.stringContaining("verify_backup_metadata \"$METADATA_PATH\" \"$DRILL_DATABASE_URL\" 'restore drill'"));
    // Die Metadatei haengt an derselben Pruefsumme wie der Dump.
    expect(restore).toEqual(expect.stringContaining('verify_backup_file "$METADATA_PATH" "$CHECKSUM_MANIFEST"'));
    expect(drill).toEqual(expect.stringContaining('verify_backup_file "$METADATA_PATH" "$CHECKSUM_MANIFEST"'));
    // doctor zeigt Schemastand und benoetigten Schluessel, bevor es ernst wird.
    expect(doctor).toEqual(expect.stringContaining('backup_secret_key_ids='));
    expect(doctor).toEqual(expect.stringContaining('backup_schema_migration='));
    // Jeder Dienst, der eines der Skripte ausfuehrt, braucht den Helfer.
    expect(compose.match(/backup-metadata\.sh:\/app\/backup-metadata\.sh:ro/g)).toHaveLength(5);
  });

  test('documents optional Docker profiles without adding them to the standard stack', () => {
    const compose = readRepoFile('docker/docker-compose.yml');
    const setupServer = readRepoFile('docs/SETUP_SERVER.md');

    expect(compose).toEqual(expect.stringContaining('profiles: ["minio"]'));
    expect(compose).toEqual(expect.stringContaining('profiles: ["monitor"]'));
    expect(compose).toEqual(expect.stringContaining('profiles: ["pgadmin"]'));
    expect(compose).toEqual(expect.stringContaining('"${MINIO_API_BIND:-127.0.0.1}:${MINIO_API_PORT:-9000}:9000"'));
    expect(compose).toEqual(expect.stringContaining('"${UPTIME_KUMA_BIND:-127.0.0.1}:${UPTIME_KUMA_PORT:-3001}:3001"'));
    expect(compose).toEqual(expect.stringContaining('"${PGADMIN_BIND:-127.0.0.1}:${PGADMIN_PORT:-5050}:80"'));
    expect(setupServer).toEqual(expect.stringContaining('The standard stack intentionally starts only Caddy, API, migrations, and PostgreSQL'));
    expect(setupServer).toEqual(expect.stringContaining('Never expose this publicly'));
  });
});
