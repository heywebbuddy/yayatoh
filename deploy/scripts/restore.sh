#!/usr/bin/env bash
# Restores the database from the pgBackRest backups: to a moment in time, or to the latest backup.
# Stops the apps, restores in place (delta), starts Postgres, then redeploys the given release.
#   sudo bash restore.sh <commit-sha> "2026-10-05 14:00:00+00"
#   sudo bash restore.sh <commit-sha> latest
set -euo pipefail
here=$(dirname "$(readlink -f "$0")")
# shellcheck source-path=SCRIPTDIR source=lib.sh
. "$here/lib.sh"

ref=${1:?usage: restore.sh <commit-sha> <"YYYY-MM-DD HH:MM:SS+00"|latest>}
target=${2:?give a time like "2026-10-05 14:00:00+00", or latest}
read -r -p "This replaces the live database. Type RESTORE to continue: " answer
[[ $answer == RESTORE ]] || { echo "Stopped."; exit 1; }

export YAYATOH_IMAGE="$IMAGE_REPO:$ref"
write_env
compose stop web admin worker
compose stop postgres
args=(--stanza=yayatoh --delta)
[[ $target == latest ]] || args+=(--type=time "--target=$target" --target-action=promote)
compose run --rm --no-deps --entrypoint bash postgres -c \
  "yayatoh-postgres-entrypoint.sh true && gosu postgres pgbackrest ${args[*]@Q} restore"
compose up -d postgres
wait_healthy postgres
bash "$here/deploy.sh" "$ref"
