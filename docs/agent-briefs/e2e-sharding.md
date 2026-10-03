# Sharded whole-suite e2e for merge batches (owner decision, Oct 3 2026)

The whole web e2e suite takes about 3 hours in one session. From now on a merge batch runs it **in three shards on three sessions at once**: same commit, same tests, same rules. Nothing is skipped; only the wall-clock time changes (about 1 hour).

## Merge session (owns the batch)
1. Get the tree green on everything except the whole e2e run: lint, check:modules, typecheck, unit, integration, `db:generate` clean, `contracts:check`, and your batch's new specs once.
2. Push, then mark the exact commit ready: `git push origin HEAD:refs/heads/e2e-ready/<batch>` (for example `e2e-ready/3k`). Force-update it only by pushing a newer commit to the same ref if you change code later; every shard result names the SHA it ran on.
3. Run **shard 1/3** yourself on that SHA: fresh DB per `merge-3e.md` environment steps 1–5, build web and admin, then `cd apps/web && npx playwright test --shard=1/3 --reporter=line` (3 projects, 2 workers, headless shell as usual).
4. The orchestrator starts two helper sessions for shards 2/3 and 3/3 when it sees the `e2e-ready/<batch>` ref (it checks every 15 minutes). They push their result to `e2e-result/<batch>-s2` and `e2e-result/<batch>-s3`: a single commit with `e2e-result.md` (SHA, passed/failed/skipped/flaky counts, and every failure with its exact error).
5. Poll with `git fetch origin 'refs/heads/e2e-result/*:refs/remotes/origin/e2e-result/*'` every few minutes (a short bash loop with `sleep 240`, each command under 10 minutes; never end your turn while waiting). If a helper's result for your SHA hasn't appeared 90 minutes after you pushed the ready ref, run that shard yourself.
6. Every failure in any shard is yours: fix the real cause, then rerun the affected specs on the headless shell (and `--repeat-each=5` for anything you would call flaky, with its exact error, as before). If you change product code after the shards ran, the shards whose specs could be affected are rerun (by you, or push a new `e2e-ready` SHA and the orchestrator restarts helpers).
7. Then the admin suite yourself, as before. Your report lists all three shards' numbers and the SHA they ran on.

## Helper session (one shard)
- Check out exactly the SHA in `e2e-ready/<batch>`, follow `merge-3e.md` environment steps 1–5 (fresh DB), build web and admin, run `cd apps/web && npx playwright test --shard=<N>/3 --reporter=line`.
- Never change product or test code. For each failing test, rerun it alone once and record both results.
- Push one commit with `e2e-result.md` to `e2e-result/<batch>-s<N>` (create the branch from the SHA; force-push allowed only on this result branch). Then stop.

## Running ahead (owner decision, same day)
A merge batch may start on top of the previous batch's merge branch before that batch has landed. Before your final gate you merge the newest build branch (and the newest head of the batch you started on); the final checks above run on that combined tree, so the bar is unchanged.
