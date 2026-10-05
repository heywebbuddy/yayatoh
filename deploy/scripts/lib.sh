# shellcheck shell=bash
# Shared by the deploy scripts. Sourced, not run.
set -euo pipefail

SRC=/opt/yayatoh/src
RUN_DIR=/run/yayatoh

[[ $EUID -eq 0 ]] || { echo "Run as root (sudo)." >&2; exit 1; }
[[ -f /etc/yayatoh/deploy.env ]] || { echo "Missing /etc/yayatoh/deploy.env (run server-setup.sh)." >&2; exit 1; }
set -a
# shellcheck disable=SC1091
. /etc/yayatoh/deploy.env
set +a
# shellcheck disable=SC2034 # used by the scripts that source this file
IMAGE_REPO=${YAYATOH_IMAGE_REPO:-ghcr.io/heywebbuddy/yayatoh}

# Writes the runtime environment from Doppler (project yayatoh, config prd) to tmpfs, root only.
# The app gets everything except the database superuser and backup keys; Postgres gets only those,
# and only the one-off bootstrap task gets the superuser connection.
write_env() {
  local token_file=/etc/yayatoh/doppler.token
  [[ -s $token_file ]] || { echo "Missing $token_file (a read-only Doppler service token for yayatoh/prd)." >&2; exit 1; }
  install -d -m 0700 "$RUN_DIR"
  local all
  all=$(DOPPLER_TOKEN=$(cat "$token_file") doppler secrets download --no-file --format docker)
  ( umask 077
    grep -v -E '^(POSTGRES_PASSWORD|ADMIN_DATABASE_URL|BACKUP_[A-Z_]+|DOPPLER_[A-Z_]+)=' <<<"$all" > "$RUN_DIR/app.env"
    grep -E '^(POSTGRES_PASSWORD|BACKUP_[A-Z_]+)=' <<<"$all" > "$RUN_DIR/postgres.env" || true
    grep -E '^ADMIN_DATABASE_URL=' <<<"$all" > "$RUN_DIR/bootstrap.env" || true )
  grep -q '^POSTGRES_PASSWORD=' "$RUN_DIR/postgres.env" || { echo "Doppler has no POSTGRES_PASSWORD." >&2; exit 1; }
  # The image refuses dev-only settings in production anyway; refuse them here before anything starts.
  if grep -q -E '^(FAKE_PAYMENTS_SECRET|FAKE_EMAIL_WEBHOOK_SECRET|LOCAL_KMS_KEY|YAYATOH_DEV_AUTH|DEV_PERSONA_PASSWORD)=' "$RUN_DIR/app.env"; then
    echo "Doppler prd contains a development-only setting (FAKE_*, LOCAL_KMS_KEY, YAYATOH_DEV_AUTH or DEV_PERSONA_PASSWORD). Remove it first." >&2
    exit 1
  fi
}

compose() {
  docker compose -f "$SRC/deploy/docker-compose.prod.yml" --project-directory "$SRC/deploy" "$@"
}

# Checks out the deploy files of the release being deployed (the image and these files move together).
checkout() {
  local ref=$1
  git -C "$SRC" fetch --quiet origin main
  git -C "$SRC" checkout --quiet --detach "$ref"
}

wait_healthy() {
  local svc=$1 tries=60
  while (( tries-- > 0 )); do
    local id status
    id=$(compose ps -q "$svc")
    status=$(docker inspect -f '{{.State.Health.Status}}' "$id" 2>/dev/null || echo starting)
    [[ $status == healthy ]] && return 0
    sleep 5
  done
  echo "$svc did not become healthy; see: docker compose logs $svc" >&2
  return 1
}
