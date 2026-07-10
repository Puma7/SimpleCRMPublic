#!/bin/sh
set -eu

: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${PG_APP_PASSWORD:?PG_APP_PASSWORD is required}"

PG_APP_USER="${PG_APP_USER:-simplecrm_app}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_user="$PG_APP_USER" \
  -v app_password="$PG_APP_PASSWORD" \
  -v db_name="$POSTGRES_DB" <<'SQL'
SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE',
  :'app_user',
  :'app_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user');
\gexec

SELECT format(
  'ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE',
  :'app_user',
  :'app_password'
);
\gexec

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE SCHEMA IF NOT EXISTS app;

SELECT format('ALTER DATABASE %I OWNER TO %I', :'db_name', :'app_user');
\gexec
SELECT format('GRANT CONNECT, TEMPORARY, CREATE ON DATABASE %I TO %I', :'db_name', :'app_user');
\gexec
SELECT format('ALTER SCHEMA public OWNER TO %I', :'app_user');
\gexec
SELECT format('ALTER SCHEMA app OWNER TO %I', :'app_user');
\gexec
SELECT format('GRANT USAGE, CREATE ON SCHEMA public TO %I', :'app_user');
\gexec
SELECT format('GRANT USAGE, CREATE ON SCHEMA app TO %I', :'app_user');
\gexec
SQL
