#!/usr/bin/env bash
# Deploys one release: the image built from <commit> by .github/workflows/image.yml, with the
# deploy files from the same commit. Migrations (expand-only, roadmap §9) run before the new apps
# start; the old apps keep serving until then. Roll back by deploying the previous commit.
#   sudo bash /opt/yayatoh/src/deploy/scripts/deploy.sh <commit-sha>
set -euo pipefail
here=$(dirname "$(readlink -f "$0")")
# shellcheck source-path=SCRIPTDIR source=lib.sh
. "$here/lib.sh"

ref=${1:?usage: deploy.sh <commit-sha>}
[[ $ref =~ ^[0-9a-f]{40}$ ]] || { echo "Give the full 40-character commit sha." >&2; exit 1; }

checkout "$ref"
export YAYATOH_IMAGE="$IMAGE_REPO:$ref"
write_env

echo "==> Pulling $YAYATOH_IMAGE"
compose pull web
compose build postgres
compose up -d postgres gotenberg

echo "==> Migrating"
compose run --rm migrate

echo "==> Starting the release"
compose up -d --remove-orphans web admin worker caddy
wait_healthy web
wait_healthy admin

mkdir -p /var/lib/yayatoh
echo "$(date -u +%FT%TZ) $ref" >> /var/lib/yayatoh/releases.log
docker image prune -f --filter "until=168h" >/dev/null
echo "==> Live: $ref"
