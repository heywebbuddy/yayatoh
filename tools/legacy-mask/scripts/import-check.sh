#!/usr/bin/env bash
# Proves a masked dump still imports: loads an original dump and its masked copy into two
# fresh MySQL databases and compares every table's row count (tables emptied by rule must be
# empty). Used by CI with the synthetic fixture; the owner can run it against the real pair on
# their own server before sending the masked file.
#   MYSQL="mysql -h127.0.0.1 -uroot -p…" import-check.sh original.sql masked.sql
set -euo pipefail
ORIG=$1
MASKED=$2
MYSQL=${MYSQL:-mysql}
DROPPED=" sessions password_resets otps cache cache_locks jobs job_batches failed_jobs webhook_test "
cat_any() { case "$1" in *.gz) gunzip -c "$1" ;; *) cat "$1" ;; esac; }

$MYSQL -e "DROP DATABASE IF EXISTS mask_check_orig; DROP DATABASE IF EXISTS mask_check_masked; CREATE DATABASE mask_check_orig; CREATE DATABASE mask_check_masked;"
cat_any "$ORIG" | $MYSQL mask_check_orig
cat_any "$MASKED" | $MYSQL mask_check_masked
fail=0
for t in $($MYSQL -N -e "SELECT table_name FROM information_schema.tables WHERE table_schema='mask_check_orig' ORDER BY 1"); do
  o=$($MYSQL -N -e "SELECT COUNT(*) FROM mask_check_orig.\`$t\`")
  m=$($MYSQL -N -e "SELECT COUNT(*) FROM mask_check_masked.\`$t\`" 2>/dev/null || echo missing)
  want=$o
  [[ "$DROPPED" == *" $t "* ]] && want=0
  if [ "$m" != "$want" ]; then echo "FAIL $t: masked=$m expected=$want"; fail=1; else echo "ok   $t: $o → $m"; fi
done
# JSON columns must still hold valid JSON.
for c in $($MYSQL -N -e "SELECT CONCAT(table_name,'.',column_name) FROM information_schema.columns WHERE table_schema='mask_check_masked' AND data_type='json'"); do
  bad=$($MYSQL -N -e "SELECT COUNT(*) FROM mask_check_masked.\`${c%%.*}\` WHERE \`${c#*.}\` IS NOT NULL AND JSON_VALID(\`${c#*.}\`)=0")
  [ "$bad" != "0" ] && { echo "FAIL $c: $bad invalid JSON values"; fail=1; }
done
$MYSQL -e "DROP DATABASE mask_check_orig; DROP DATABASE mask_check_masked;"
[ $fail -eq 0 ] && echo "import-check: OK — the masked dump loads and keeps every row" || exit 1
