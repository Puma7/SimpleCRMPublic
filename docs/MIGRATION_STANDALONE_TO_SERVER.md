# Standalone To Server Migration

This document covers the current migration primitive from standalone PostgreSQL to a server PostgreSQL instance.

## Current Tool

Root script:

```sh
npm run migrate:standalone-to-server -- --help
```

Compiled target:

```sh
node packages/desktop/dist/cli/migrate-to-server.js --help
```

The tool builds a non-shell execution plan:

- `pg_dump -Fc --file <dump> <source>`
- `pg_restore --clean --if-exists --no-owner --dbname <target> <dump>`
- optional attachment sync by `local-copy` or `rsync`

Database URLs are redacted in dry-run output.

## Dry Run

```sh
npm run build:packages
npm run migrate:standalone-to-server -- \
  --source-database-url "postgres://local-user:local-pass@127.0.0.1:15432/simplecrm" \
  --target-database-url "postgres://server-user:server-pass@crm.example.com:5432/simplecrm" \
  --dump-path "./standalone.dump" \
  --attachments-mode skip \
  --dry-run
```

Review the JSON plan before running without `--dry-run`.

## Migrate With Local Attachment Copy

```sh
npm run migrate:standalone-to-server -- \
  --source-database-url "$STANDALONE_DATABASE_URL" \
  --target-database-url "$DATABASE_URL" \
  --dump-path "./standalone.dump" \
  --attachments-mode local-copy \
  --attachments-source-dir "/path/to/local/attachments" \
  --attachments-target-dir "/srv/simplecrm/attachments"
```

## Migrate With Rsync

```sh
npm run migrate:standalone-to-server -- \
  --source-database-url "$STANDALONE_DATABASE_URL" \
  --target-database-url "$DATABASE_URL" \
  --dump-path "./standalone.dump" \
  --attachments-mode rsync \
  --attachments-source-dir "/path/to/local/attachments" \
  --attachments-target "simplecrm@server:/srv/simplecrm/attachments"
```

## Post-Migration Checks

Run server migrations and doctor:

```sh
npm run migrate:server
npm run doctor:server -- --backup-dir /backups
```

Open the server UI, log in as owner, and verify:

- customers/deals/tasks are present;
- mail accounts exist without plaintext password exposure;
- attachments open from server storage;
- workflow definitions and knowledge bases are visible.

## Known Limits

- Running-application read-only coordination is not complete; stop the standalone app before migrating.
- Authenticated target-server provisioning and master-key transfer flow are not complete.
- The 100k-mail live drill and remote attachment hash verification remain open.
