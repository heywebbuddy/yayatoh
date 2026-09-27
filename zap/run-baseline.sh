#!/usr/bin/env bash
# ZAP baseline (passive) scan (M1.14d). Needs Docker and a running app:
#   pnpm --filter @yayatoh/web build && (cd apps/web && npx next start -p 3000) &
#   bash zap/run-baseline.sh http://localhost:3000
# Staging: bash zap/run-baseline.sh https://staging.example  (owner-approved targets only).
# Exits non-zero on any FAIL rule (baseline.conf) and on any High-risk alert.
set -euo pipefail
TARGET="${1:-http://localhost:3000}"
DIR="$(cd "$(dirname "$0")" && pwd)"
IMAGE="${ZAP_IMAGE:-ghcr.io/zaproxy/zaproxy:stable}"
chmod 777 "$DIR"
set +e
docker run --rm --network host -v "$DIR:/zap/wrk:rw" "$IMAGE" \
  zap-baseline.py -t "$TARGET" -c baseline.conf -m "${ZAP_MINUTES:-3}" \
  -r zap-report.html -J zap-report.json -I
set -e
HIGH=$(python3 -c "import json,sys; d=json.load(open('$DIR/zap-report.json')); print(sum(1 for s in d['site'] for a in s['alerts'] if a['riskcode']=='3'))")
FAILS=$(python3 - "$DIR" <<'PY'
import json, sys
d = json.load(open(sys.argv[1] + '/zap-report.json'))
conf = {l.split('\t')[0]: l.split('\t')[1] for l in open(sys.argv[1] + '/baseline.conf') if l[:1].isdigit()}
print(sum(1 for s in d['site'] for a in s['alerts'] if conf.get(a['pluginid']) == 'FAIL'))
PY
)
echo "ZAP baseline: high=$HIGH fail-rules=$FAILS (report: zap/zap-report.html)"
[ "$HIGH" = "0" ] && [ "$FAILS" = "0" ]
