#!/usr/bin/env bash
# Off-account logical backup (M1.14d, roadmap: PITR + off-account dumps).
#   SOURCE_URL   postgres URL with read access to every schema (a read-only replica role in prod)
#   DUMP_DIR     where the encrypted dump goes (local fake of the off-account bucket)
#   AGE_RECIPIENT  public key of the offline backup key (owner). Without it the dump is NOT
#                  encrypted and the script refuses unless ALLOW_PLAINTEXT=1 (local drills only).
# Production: run from the worker's scheduled job host with credentials the owner enters; upload
# the result to the backup account's bucket with Object Lock (owner inbox, M1.14).
set -euo pipefail
: "${SOURCE_URL:?set SOURCE_URL}"
DUMP_DIR="${DUMP_DIR:-./backups}"
IMAGE="${PG_IMAGE:-postgres:18}"
mkdir -p "$DUMP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$DUMP_DIR/yayatoh-$STAMP.dump"
docker run --rm --network host -v "$(cd "$DUMP_DIR" && pwd):/out" "$IMAGE" \
  pg_dump --format=custom --no-owner --no-privileges --file="/out/$(basename "$OUT")" "$SOURCE_URL"
sha256sum "$OUT" > "$OUT.sha256"
if [ -n "${AGE_RECIPIENT:-}" ]; then
  age -r "$AGE_RECIPIENT" -o "$OUT.age" "$OUT" && rm "$OUT"
  echo "offsite-dump: $OUT.age"
elif [ "${ALLOW_PLAINTEXT:-}" = "1" ]; then
  echo "offsite-dump: $OUT (PLAINTEXT, local drill only)"
else
  rm -f "$OUT" "$OUT.sha256"
  echo "offsite-dump: refusing to keep an unencrypted dump (set AGE_RECIPIENT)" >&2
  exit 1
fi
