#!/usr/bin/env bash
# Sends payloads/<name>.json to the booted iOS simulator, with ${TICKET_ID}, ${ORDER_ID} and
# ${EVENT_SLUG} filled in from the environment.
# Usage: send-push.sh <name>        (APP_ID, TICKET_ID, ORDER_ID, EVENT_SLUG must be set)
#
# Android has no equivalent tool: its pushes come from the owner's FCM project (an owner account
# step, docs/owner-inbox.md), so the Android part of the device pass sends them from there.
set -euo pipefail
name="${1:?payload name}"
here="$(cd "$(dirname "$0")" && pwd)"
: "${APP_ID:?set APP_ID to the build's bundle id}"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
envsubst '${TICKET_ID} ${ORDER_ID} ${EVENT_SLUG}' < "$here/payloads/$name.json" > "$tmp"
xcrun simctl push booted "$APP_ID" "$tmp"
