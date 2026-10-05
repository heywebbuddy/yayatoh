#!/bin/bash
# Writes the pgBackRest configuration from the environment, then starts Postgres with WAL
# archiving to the backup bucket. Refuses to start without backup settings unless BACKUP_DISABLED=1
# is set on purpose: an archive_command that cannot succeed would fill the disk with WAL.
set -euo pipefail

STANZA=yayatoh
ARCHIVE_ARGS=()
if [[ "${BACKUP_DISABLED:-}" == "1" ]]; then
  echo "yayatoh-postgres: BACKUP_DISABLED=1, WAL archiving is OFF (no point-in-time recovery)" >&2
else
  for v in BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_KEY BACKUP_S3_KEY_SECRET BACKUP_CIPHER_PASS; do
    if [[ -z "${!v:-}" ]]; then
      echo "yayatoh-postgres: $v is not set (or set BACKUP_DISABLED=1 deliberately)" >&2
      exit 1
    fi
  done
  umask 077
  cat > /etc/pgbackrest/pgbackrest.conf <<CONF
[global]
repo1-type=s3
repo1-path=/pgbackrest
repo1-s3-endpoint=${BACKUP_S3_ENDPOINT}
repo1-s3-bucket=${BACKUP_S3_BUCKET}
repo1-s3-region=${BACKUP_S3_REGION:-auto}
repo1-s3-key=${BACKUP_S3_KEY}
repo1-s3-key-secret=${BACKUP_S3_KEY_SECRET}
repo1-s3-uri-style=path
repo1-cipher-type=aes-256-cbc
repo1-cipher-pass=${BACKUP_CIPHER_PASS}
repo1-retention-full=${BACKUP_RETENTION_FULL:-4}
start-fast=y
compress-type=zst
process-max=2
archive-async=y
spool-path=/var/spool/pgbackrest
log-level-console=info
log-level-file=detail

[${STANZA}]
pg1-path=${PGDATA}
pg1-user=${POSTGRES_USER:-postgres}
CONF
  chown postgres:postgres /etc/pgbackrest/pgbackrest.conf
  ARCHIVE_ARGS=(
    -c archive_mode=on
    -c "archive_command=pgbackrest --stanza=${STANZA} archive-push %p"
    -c archive_timeout=60
  )
fi

if [[ "${1:-}" == "postgres" ]]; then
  shift
  set -- postgres -c wal_level=replica -c max_wal_senders=3 "${ARCHIVE_ARGS[@]}" "$@"
fi
exec docker-entrypoint.sh "$@"
