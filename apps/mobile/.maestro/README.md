# Maestro flows for Discover and buy (M7.3c)

Written, not run: the cloud sessions have no simulator or emulator. The device pass runs them against a
development build (`APP_ENV=development`, `PAYMENTS_PROVIDER` unset, so the fake payment page is used)
with the seeded personas. The server needs `pnpm db:bootstrap && pnpm db:migrate && pnpm seed`.

| Flow | What it proves |
|---|---|
| `search-and-buy.yaml` | Search, event page, ticket selection, checkout with the fake provider, the confirmation, the ticket in My tickets |
| `cancel-payment.yaml` | Closing the payment page returns to the event with the selection intact; paying again makes the one order |
| `virtual-ticket.yaml` | An online event shows "Buy on the web" and no way to buy in the app |
| `near-me.yaml` | "Near me" asks for the location only when tapped, and sorts nearest first |

The flows target the development build (`com.yayatoh.yayatohapp.dev`); for a preview build change the `appId` line. Environment (all optional): `EMAIL` and `PASSWORD`
(a seeded persona and `DEV_PERSONA_PASSWORD`), `EVENT_QUERY` and `EVENT_NAME` (default the seeded Harbor
Spring Concert), `ONLINE_EVENT_SLUG` (an online event created for the pass; the seed has none).

`subflows/sign-in.yaml` uses the labels M7.3a puts on the welcome screen ("Use a password"); if they change
there, change them here.

# Maestro flows for push and links (M7.3d)

Written in a cloud session with no simulator, so **none of these have been run**. The device pass
runs them against a development build (`APP_ID=com.yayatoh.yayatohapp.dev`) with the seeded
personas and the fake payment and push providers.

Environment (`maestro test -e KEY=value …`):

| Variable | Meaning |
|---|---|
| `APP_ID` | the build's bundle id / package name (`…​.dev` for a development build) |
| `SCHEME` | the build's URL scheme (`yayatoh-dev`) |
| `TICKET_ID`, `ORDER_ID`, `EVENT_SLUG` | ids of a seeded ticket, order and event of the signed-in persona |
| `CLAIM_TOKEN`, `HOLDER_TOKEN` | a seeded transfer claim token and holder link token |
| `PERSONA_EMAIL`, `PERSONA_CODE` | the seeded attendee and the fixed dev email code |

Pushes cannot be sent from Maestro. `send-push.sh` posts `payloads/<name>.json` to the booted
simulator (`xcrun simctl push`) or emulator (an FCM-style broadcast); run it from the flow's `runScript`
or by hand between steps where a flow says "send the push".

| Flow | Journey |
|---|---|
| `push-prompt-after-purchase.yaml` | no prompt at launch; after a purchase: explanation, then the phone's sheet; the phone is registered |
| `push-not-now.yaml` | "Not now": no sheet; opening tickets does not ask; the next purchase asks again |
| `push-denied-blocks-nothing.yaml` | deny the phone's sheet: purchase, ticket and Account still work; no second ask |
| `push-tap-cold-start.yaml` | each push type opens its screen from a closed app |
| `push-tap-foreground.yaml` | banner in the foreground, tap opens the screen, no personal data on it |
| `link-cold-start.yaml` | each universal / scheme link opens its screen from a closed app |
| `link-resume-after-sign-in.yaml` | a ticket link while signed out resumes after sign-in |
| `notification-settings.yaml` | Account → Notifications for every permission state; the phone's settings link |
| `sign-out-removes-device.yaml` | sign-out deletes the registration (check the server log: `DELETE /v1/me/devices/…`) |
