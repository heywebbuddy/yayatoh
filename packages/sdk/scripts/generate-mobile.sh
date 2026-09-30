#!/usr/bin/env bash
# Generate the Swift and Kotlin /v1 clients from apps/api/openapi.json with openapi-generator
# (pinned image). Local only, no CI job: the mobile apps are planned but not built (roadmap §8.3).
# Output goes to packages/sdk/mobile/out/ (git-ignored).
set -euo pipefail
root="$(cd "$(dirname "$0")/../../.." && pwd)"
image="openapitools/openapi-generator-cli:v7.17.0"
for lang in swift kotlin; do
  docker run --rm -u "$(id -u):$(id -g)" -v "$root:/local" "$image" batch --clean "/local/packages/sdk/mobile/$lang.yaml"
done
echo "Generated: packages/sdk/mobile/out/{swift,kotlin}"
