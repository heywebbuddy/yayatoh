# Key and secret rotation

Secrets live in Doppler (production, staging) and the cloud-environment settings (development).
Never in the repo (`.env.example` has names only; gitleaks runs in CI).

| Secret | Impact of rotating | How |
|---|---|---|
| `BETTER_AUTH_SECRET` | All sessions end (everyone signs in again) | New value in Doppler → redeploy web and admin |
| `APP_TOKEN_SECRET` (signed links: invitations, claim links, holder links) | Outstanding links stop working; people request new ones | New value → redeploy; announce to organizers if mid-event |
| `FAKE_PAYMENTS_SECRET` | Dev/preview only | New value → redeploy |
| `STRIPE_SECRET_KEY` / restricted keys | Payments stop until updated | Roll in the Stripe dashboard (keeps the old key alive for a grace period) → Doppler → redeploy web + worker → revoke old |
| `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET` | Webhooks fail verification until updated (Stripe retries 3 days) | Roll the endpoint secret in Stripe → Doppler → redeploy → replay failures ([webhook-replay.md](webhook-replay.md)) |
| KMS key (ticket-signing keys, sensitive answers, tokens) | None if rotated in KMS (envelope encryption keeps old versions) | Enable automatic yearly rotation in AWS KMS; never delete old key versions |
| Org ticket-signing keys | New tickets get the new key; old QR codes stay valid while the old public key is published | Per org, from the staff console (planned) |
| Database role passwords (`app_user`, `migrator`, `platform_reader`) | Brief connection errors during the switch | `ALTER ROLE … PASSWORD` in Neon → Doppler → redeploy; old sessions drain |
| `UPSTASH_REDIS_REST_TOKEN` | Rate limiter fails open until updated (logged) | Rotate in Upstash → Doppler → redeploy |
| Offline backup key (`age`) | New dumps use the new key; keep the old private key until old dumps expire | Generate a new key pair offline; update `AGE_RECIPIENT` |

**Schedule:** yearly for everything; immediately when a person with access leaves, a laptop is
lost, or a secret appears anywhere it shouldn't (chat, logs, a PR). A leaked secret is a SEV1
([incident.md](incident.md)).

**Check after rotating:** sign in, buy with the fake/Stripe test provider on staging, scan, open
Activity (Verified), and confirm the worker processed a job.
