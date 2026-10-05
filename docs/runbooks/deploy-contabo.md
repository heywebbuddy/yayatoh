# Deploy on the Contabo server

**Who:** the owner runs every production step (CLAUDE.md → Safety); Claude Code prepares releases and checks results. **Decision:** ADR 0024. **Files:** `deploy/`, `Dockerfile`, `.github/workflows/image.yml`.

What runs on the server: Caddy (HTTPS), web (site, organizer console, `/api/v1`), admin (staff console), worker (jobs, messaging), Gotenberg (PDFs) and Postgres 18 with pgvector and pgBackRest. Only ports 22, 80 and 443 are open.

## A. One-time setup (owner, about an hour)

### A1. Accounts and values (before touching the server)
1. **Container images:** after the first `image` workflow run on `main`, open GitHub → your profile → **Packages** → `yayatoh` → **Package settings** → **Change visibility → Public**. The image holds only the public repo's code, no secrets. The server then pulls it without a token.
2. **Backup bucket:** in Cloudflare R2 create a bucket `yayatoh-db-backups` (separate from media) and an **R2 API token** scoped to that bucket only (Object Read & Write). Note the S3 endpoint `https://<account-id>.r2.cloudflarestorage.com`.
3. **AWS KMS key:** AWS console → **KMS** (region `us-east-1`) → **Create key** (symmetric, encrypt and decrypt), alias `yayatoh-prod`. Create an IAM user `yayatoh-kms` with an inline policy allowing `kms:GenerateDataKey` and `kms:Decrypt` on that key's ARN only, and an access key for it.
4. **Doppler service token:** Doppler → `yayatoh` → `prd` → **Access** → **Generate service token** (read only), name `contabo`. It goes on the server in step A3; never in chat.
5. **Add these to Doppler `prd`.** Generate every password with Doppler's generator, letters and numbers only (they go inside URLs). The `${…}` references are Doppler's secret references, so each password is typed once.

| Name | Value |
|---|---|
| `POSTGRES_PASSWORD` | generated, 40 characters |
| `DB_APP_PASSWORD`, `DB_MIGRATOR_PASSWORD`, `DB_READER_PASSWORD` | generated, 40 characters each |
| `DATABASE_URL` | `postgres://app_user:${DB_APP_PASSWORD}@postgres:5432/yayatoh` |
| `MIGRATOR_DATABASE_URL` | `postgres://migrator:${DB_MIGRATOR_PASSWORD}@postgres:5432/yayatoh` |
| `JOBS_DATABASE_URL` | same as `MIGRATOR_DATABASE_URL` (pg-boss owns its queue schema) |
| `PLATFORM_READER_DATABASE_URL` | `postgres://platform_reader:${DB_READER_PASSWORD}@postgres:5432/yayatoh` |
| `ADMIN_DATABASE_URL` | `postgres://postgres:${POSTGRES_PASSWORD}@postgres:5432/yayatoh` (bootstrap only; the apps never see it) |
| `AWS_KMS_KEY_ID` | `alias/yayatoh-prod` |
| `AWS_KMS_REGION` | `us-east-1` |
| `AWS_KMS_ACCESS_KEY_ID`, `AWS_KMS_SECRET_ACCESS_KEY` | the `yayatoh-kms` access key |
| `BACKUP_S3_ENDPOINT` | the R2 S3 endpoint |
| `BACKUP_S3_BUCKET` | `yayatoh-db-backups` |
| `BACKUP_S3_KEY`, `BACKUP_S3_KEY_SECRET` | the backup bucket's R2 token |
| `BACKUP_CIPHER_PASS` | generated, 64 characters. **Also store it outside Doppler** (password manager): without it no backup can be restored |
| `DOMAIN_PROVIDER` | `self_hosted` |
| `DOMAIN_CNAME_TARGET` | `sites.yayatoh.com` |
| `ADMIN_AUTH_URL` | `https://admin.yayatoh.com` |
| `PASSKEY_RP_ID` | `yayatoh.com` |

Already listed elsewhere: `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_ORIGIN`, the provider keys. Never in `prd`: `FAKE_*`, `LOCAL_KMS_KEY`, `YAYATOH_DEV_AUTH`, `DEV_PERSONA_PASSWORD` (the deploy refuses to start).

### A2. DNS (at your DNS provider)
| Record | Type | Value |
|---|---|---|
| `app.yayatoh.com` | A | the server's IP |
| `admin.yayatoh.com` | A | the server's IP |
| `sites.yayatoh.com` | A | the server's IP (custom domains CNAME to it) |
| `*.yayatoh.events` | A | the server's IP (tenant sites) |

`yayatoh.com` and `abc.yayatoh.com` stay on the legacy server until the cutover (`cutover.md`).

### A3. The server
1. From your computer: `ssh root@<server-ip>`.
2. Run the setup (updates, firewall, Docker, Doppler CLI, deploy user, backup timers):
   ```sh
   curl -fsSL https://raw.githubusercontent.com/heywebbuddy/yayatoh/main/deploy/scripts/server-setup.sh -o /root/server-setup.sh
   less /root/server-setup.sh     # read it first
   bash /root/server-setup.sh
   ```
3. Save the Doppler token without it landing in your shell history:
   ```sh
   read -rs -p "Doppler token: " T && printf '%s' "$T" > /etc/yayatoh/doppler.token && chmod 600 /etc/yayatoh/doppler.token && unset T
   ```
4. `nano /etc/yayatoh/deploy.env`: set `ACME_EMAIL`, and the Postgres memory lines for your server size.

### A4. First run
Pick the commit to release (Claude Code gives you the sha of a green `main` whose `image` workflow passed), then:
```sh
sudo bash /opt/yayatoh/src/deploy/scripts/first-run.sh <commit-sha>
```
It creates the database roles and pgvector, sets up backups and takes the first full backup, migrates, and starts everything. Then check:
- `https://app.yayatoh.com/api/health` shows `{"ok":true}`.
- Sign-in works; the staff console opens at `https://admin.yayatoh.com`.
- Create the first staff account: `sudo docker compose -f /opt/yayatoh/src/deploy/docker-compose.prod.yml --project-directory /opt/yayatoh/src/deploy exec worker node scripts/staff.ts --help`.

### A5. Monitoring
- An external uptime check (UptimeRobot, Better Stack) on `https://app.yayatoh.com/api/health` every minute, alerting your phone.
- Contabo's control panel alerts for CPU and disk, if offered. The daily backup `check` writes to the journal: `journalctl -u yayatoh-backup-check`.

## B. Every release
1. Claude Code merges to `main`; CI is green; the `image` workflow pushes `ghcr.io/heywebbuddy/yayatoh:<sha>`.
2. Not within 72 hours of an event with sales or check-ins, unless it fixes a SEV1/SEV2 (`deploy.md`).
3. On the server:
   ```sh
   sudo bash /opt/yayatoh/src/deploy/scripts/deploy.sh <commit-sha>
   ```
   It pulls the image, runs migrations (expand-only), starts the new web, admin and worker, and waits for their health checks. The previous apps keep serving until the new ones start.
4. Watch for 30 minutes (`deploy.md` → Steps 6). Logs: `sudo docker compose -f /opt/yayatoh/src/deploy/docker-compose.prod.yml --project-directory /opt/yayatoh/src/deploy logs -f web worker`.

**Rollback:** deploy the previous sha from `/var/lib/yayatoh/releases.log`. Migrations are expand-only, so the previous code runs on the newer schema.

## C. Backups and restore
- **What:** pgBackRest, encrypted, to the R2 bucket. Full every Sunday 03:15 UTC, differential Monday–Saturday, WAL every minute (restore to any moment). Four weeks of fulls are kept.
- **Check by hand:** `sudo bash /opt/yayatoh/src/deploy/scripts/backup.sh check`.
- **Restore** (owner, with Claude Code on the call). To a moment in time, for example just before a bad change, or to the latest backup:
  ```sh
  sudo bash /opt/yayatoh/src/deploy/scripts/restore.sh <current-sha> "2026-10-05 14:00:00+00"
  sudo bash /opt/yayatoh/src/deploy/scripts/restore.sh <current-sha> latest
  ```
  It asks you to type `RESTORE`, stops the apps, restores in place, and redeploys.
- **Monthly drill:** restore the latest backup into a scratch server or a second compose project and run `restore-drill.md`'s checks. A backup never restored is not a backup.

## D. Notes
- Secrets exist on the server only in `/run/yayatoh` (memory, root only) and inside the running containers. Rotating a secret = change it in Doppler, then redeploy the same sha.
- Disk: `df -h /` and `sudo docker system df`. Old images are pruned after 7 days.
- OS updates install automatically; reboot during a quiet hour when `/var/run/reboot-required` exists. Containers start again on their own.
