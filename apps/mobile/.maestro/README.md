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

Environment (all optional): `APP_ID` (default `com.yayatoh.yayatohapp.dev`), `EMAIL` and `PASSWORD`
(a seeded persona and `DEV_PERSONA_PASSWORD`), `EVENT_QUERY` and `EVENT_NAME` (default the seeded Harbor
Spring Concert), `ONLINE_EVENT_SLUG` (an online event created for the pass; the seed has none).

`subflows/sign-in.yaml` uses the labels M7.3a puts on the welcome screen ("Use a password"); if they change
there, change them here.
