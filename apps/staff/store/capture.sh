#!/usr/bin/env bash
# Thin wrapper: see tools/store-kit/capture.sh for the options and what the device needs.
exec "$(dirname "$0")/../../../tools/store-kit/capture.sh" staff "$@"
