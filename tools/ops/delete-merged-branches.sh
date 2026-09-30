#!/usr/bin/env bash
# Deletes remote branches that are already fully merged into the integration branch (housekeeping
# for finished agent/* branches). Dry run by default: it lists what it would delete and deletes
# only with --yes. Run it from a clone with push rights to origin (Claude Code sessions can't
# delete branches).
#   BASE      branch the others must be merged into (default m0.5-foundation-ey5gqp)
#   REMOTE    remote name (default origin)
#   KEEP      extra space-separated branch names never to delete
# Usage: tools/ops/delete-merged-branches.sh [--yes]
set -euo pipefail
BASE="${BASE:-m0.5-foundation-ey5gqp}"
REMOTE="${REMOTE:-origin}"
KEEP="main master $BASE ${KEEP:-}"
APPLY=0
[ "${1:-}" = "--yes" ] && APPLY=1

git fetch --quiet --prune "$REMOTE"
git rev-parse --verify --quiet "$REMOTE/$BASE" > /dev/null || { echo "no branch $REMOTE/$BASE" >&2; exit 1; }
DEFAULT=$(git symbolic-ref --quiet --short "refs/remotes/$REMOTE/HEAD" 2>/dev/null | sed "s#^$REMOTE/##" || true)
KEEP="$KEEP $DEFAULT"

# A branch that was just created points at a BASE commit and looks "merged" too; count a branch as
# merged only if a merge commit on BASE brought its tip in, or it hasn't moved for a week.
merge_parents=" $(git rev-list --merges --parents "$REMOTE/$BASE" | cut -d' ' -f3- | tr '\n' ' ') "
week_ago=$(( $(date +%s) - 7 * 86400 ))

merged=()
kept=()
for ref in $(git for-each-ref --format='%(refname:short)' "refs/remotes/$REMOTE/"); do
  name="${ref#"$REMOTE"/}"
  [ "$name" = HEAD ] || [ "$ref" = "$REMOTE" ] && continue
  if [[ " $KEEP " == *" $name "* ]]; then kept+=("$name (protected)"); continue; fi
  if git merge-base --is-ancestor "$ref" "$REMOTE/$BASE"; then
    tip=$(git rev-parse "$ref")
    if [[ "$merge_parents" == *" $tip "* ]] || [ "$(git log -1 --format=%ct "$ref")" -lt "$week_ago" ]; then
      merged+=("$name")
    else
      kept+=("$name (no merge commit on $BASE yet; recent)")
    fi
  else
    kept+=("$name ($(git rev-list --count "$REMOTE/$BASE..$ref") commits not in $BASE)")
  fi
done

echo "Kept:"
for k in "${kept[@]}"; do echo "  $k"; done
if [ ${#merged[@]} -eq 0 ]; then echo "Nothing to delete."; exit 0; fi
echo "Fully merged into $BASE:"
for m in "${merged[@]}"; do echo "  $m"; done

if [ $APPLY -eq 0 ]; then
  echo "Dry run. Re-run with --yes to delete these ${#merged[@]} branches from $REMOTE."
  exit 0
fi
git push "$REMOTE" --delete "${merged[@]}"
echo "Deleted ${#merged[@]} branches."
