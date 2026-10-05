#!/usr/bin/env bash
# pgBackRest jobs, run by the systemd timers: full | diff | check.
set -euo pipefail
here=$(dirname "$(readlink -f "$0")")
# shellcheck source-path=SCRIPTDIR source=lib.sh
. "$here/lib.sh"
kind=${1:?usage: backup.sh full|diff|check}
case $kind in
  full | diff) compose exec -T -u postgres postgres pgbackrest --stanza=yayatoh --type="$kind" backup ;;
  check) compose exec -T -u postgres postgres pgbackrest --stanza=yayatoh check
         compose exec -T -u postgres postgres pgbackrest --stanza=yayatoh info ;;
  *) echo "unknown: $kind" >&2; exit 1 ;;
esac
