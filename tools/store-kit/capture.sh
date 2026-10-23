#!/usr/bin/env bash
# Runs one app's store-screenshot flows on the booted simulator or emulator (M7.5a, device pass).
#
#   tools/store-kit/capture.sh <mobile|staff> --device iphone-6.9 --theme light [--locale en]
#       [--env KEY=value ...]
#
# The device must already be booted with a PREVIEW build installed and the reviewer demo seeded
# (docs/runbooks/mobile-release.md, "Screenshots"). Pass the demo values with --env, for example
#   --env REVIEW_DEMO_EMAIL=… --env REVIEW_DEMO_CODE=…                       (Yayatoh)
#   --env ENROL_EVENT=… --env ENROL_KEY=… --env TICKET_CODE=… --env HOLDER_NAME=…   (Staff)
# PNGs land in apps/<app>/store/screenshots/<platform>/<locale>/<device>/<theme>/<order>-<screen>.png;
# `node tools/store-kit/cli.ts shots --app <app>` then checks every file and its pixel size.
# It never touches a store, EAS or any account.
set -euo pipefail

app="${1:-}"; shift || true
device=""; theme="light"; locale="en"; extra=()
while [ $# -gt 0 ]; do
  case "$1" in
    --device) device="$2"; shift 2 ;;
    --theme) theme="$2"; shift 2 ;;
    --locale) locale="$2"; shift 2 ;;
    --env) extra+=("-e" "$2"); shift 2 ;;
    *) echo "Unknown option $1" >&2; exit 2 ;;
  esac
done
case "$app" in mobile|staff) ;; *) echo "Usage: capture.sh <mobile|staff> --device <id> --theme light|dark" >&2; exit 2 ;; esac
case "$theme" in light|dark) ;; *) echo "--theme must be light or dark" >&2; exit 2 ;; esac
[ -n "$device" ] || { echo "--device is required (see apps/$app/store/screenshots.json)" >&2; exit 2; }

root="$(cd "$(dirname "$0")/../.." && pwd)"
plan="$root/apps/$app/store/screenshots.json"
platform="$(node -e "const p=require('$plan');const d=p.devices.find(x=>x.id==='$device');if(!d){process.exit(3)}console.log(d.platform)")" \
  || { echo "Unknown device $device" >&2; exit 2; }
out="$root/apps/$app/store/screenshots/$platform/$locale/$device/$theme"
mkdir -p "$out"

# Light or dark, and a clean status bar (9:41, full battery, no carrier).
if [ "$platform" = ios ]; then
  xcrun simctl ui booted appearance "$theme"
  xcrun simctl status_bar booted override --time 9:41 --batteryState charged --batteryLevel 100 \
    --cellularMode active --cellularBars 4 --wifiBars 3 || true
else
  adb shell cmd uimode night "$([ "$theme" = dark ] && echo yes || echo no)"
  adb shell settings put global sysui_demo_allowed 1 || true
  adb shell am broadcast -a com.android.systemui.demo -e command enter || true
  adb shell am broadcast -a com.android.systemui.demo -e command clock -e hhmm 0941 || true
  adb shell am broadcast -a com.android.systemui.demo -e command battery -e level 100 -e plugged false || true
fi

# One flow per planned screen on this device, in plan order.
node -e "
const p=require('$plan');
p.screens.forEach((s,i)=>{ if(s.devices.includes('$device')) console.log(s.flow) })" |
while read -r flow; do
  echo "== $flow ($device, $theme, $locale)"
  (cd "$root/apps/$app" && maestro test "${extra[@]+"${extra[@]}"}" -e "SHOT_DIR=$out" "$flow")
done

echo "Done. Check the folder: node tools/store-kit/cli.ts shots --app $app --locale $locale"
