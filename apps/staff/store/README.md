# Store launch kit: Yayatoh Staff (M7.5a)

Everything the App Store and Google Play ask for, as files that tests check. Nothing here touches a store, EAS or an account; the owner follows `docs/runbooks/mobile-release.md`.

| File | What it is |
|---|---|
| `store.config.json` | App Store listing in 13 locales, age-rating answers, phased release, review contact and notes (EAS Metadata format). `${NAME}` values come from the environment. |
| `play.json` | Google Play listing in 13 locales and contact details. |
| `privacy.json` | App Privacy labels and Play Data safety, derived from the shipped libraries and permissions. |
| `compliance.json` | Export compliance, age ratings, App Review guideline answers. |
| `screenshots.json` | The screens, devices, themes and output folder layout; the Maestro flows are in `../.maestro/store/`. |
| `capture.sh` | Runs the flows on the booted simulator or emulator (device pass). |

Commands (from the repository root):

```bash
pnpm --filter @yayatoh/staff privacy:check   # the labels still match the dependencies and permissions
pnpm --filter @yayatoh/staff store:check     # listing limits, compliance, screenshot plan
pnpm --filter @yayatoh/staff store:render    # fill the placeholders into store/dist/ (git-ignored)
```
