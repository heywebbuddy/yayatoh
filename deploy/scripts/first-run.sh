#!/usr/bin/env bash
# The first deploy on a new server: creates the database roles and pgvector, sets up the backup
# stanza and takes the first full backup, then deploys <commit>. Run once.
#   sudo bash /opt/yayatoh/src/deploy/scripts/first-run.sh <commit-sha>
set -euo pipefail
here=$(dirname "$(readlink -f "$0")")
# shellcheck source-path=SCRIPTDIR source=lib.sh
. "$here/lib.sh"

ref=${1:?usage: first-run.sh <commit-sha>}
checkout "$ref"
export YAYATOH_IMAGE="$IMAGE_REPO:$ref"
write_env

echo "==> Database"
compose pull web
compose build postgres
compose up -d postgres
wait_healthy postgres
compose run --rm bootstrap

if ! grep -q '^BACKUP_DISABLED=1' "$RUN_DIR/postgres.env"; then
  echo "==> Backups: stanza and first full backup"
  compose exec -T -u postgres postgres pgbackrest --stanza=yayatoh stanza-create
  compose exec -T -u postgres postgres pgbackrest --stanza=yayatoh check
  compose exec -T -u postgres postgres pgbackrest --stanza=yayatoh --type=full backup
fi

bash "$here/deploy.sh" "$ref"
