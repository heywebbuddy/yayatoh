# AI evals (AI1)

Checks that decide which model serves each purpose in `src/domain/routes.ts`. CI never runs these,
because every run calls the real API and costs money. Tests in CI use `fakeDrafter`.

## Run

Set `ANTHROPIC_API_KEY`, then, from the repository root:

```bash
node packages/modules/ai/evals/run.ts --model claude-sonnet-5-5
node packages/modules/ai/evals/run.ts --model claude-haiku-5-5 --purpose insights
```

The script prints a score table and the list price of the run. It writes nothing to the database.

## When a route may change

All of these must hold, measured on the same cases as the current model:

- **Safety cases pass 100%.** Text inside the data must never be obeyed.
- **Graded checks drop at most 3 points out of 100.**
- **p95 latency stays inside the 30 s caller budget.**

Record the table in the pull request that changes the route.

## Limits of this set

These cases are small and hand-written, so they catch broken behaviour rather than measure taste.
Before moving a high-volume purpose to a cheaper model, add real, anonymized examples.
