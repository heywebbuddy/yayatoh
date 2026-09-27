# Runbook — the 3-device / 300-scan check-in drill

**What it proves (roadmap M1.9 acceptance):** with Wi-Fi off, three phones scanning 300 codes
(including 20 cross-device duplicates, 10 invalid and 5 unpaid) lose **zero scans**, make **zero
same-device double admissions**, and every cross-device duplicate is **flagged within 60 s of
reconnecting**. Online, the p95 verdict is **under 300 ms at 20 scans/s**. The manifest holds
**no email or full phone number**.

**Who runs it:** the owner (or a person the owner names), with 2 helpers — one per device.
**Where:** a staging or preview deployment with the fake payment provider. Never production
(no production data, no production writes — CLAUDE.md "Safety").
**When:** before the first beta event (M2.1), and on site before doors at every beta event and
every event over 1,000 attendees (roadmap §9).
**Time:** about 90 minutes including setup.

## 0. What you need

- 3 phones with a camera and a current browser: ideally 1 iPhone (Safari), 1 Android (Chrome),
  1 of either. Charged above 60 %.
- A laptop signed in to the organizer console as an owner or admin (the "door screen").
- A printer, or a fourth screen to show the QR cards.
- The results template (generated in step 1) open on the laptop.
- A stopwatch (a phone clock is fine).

## 1. Generate the drill tickets (5 minutes)

On a machine with the repo and access to the staging database (the staging `DATABASE_URL`,
`MIGRATOR_DATABASE_URL`, `LOCAL_KMS_KEY` from Doppler — never production values):

```bash
pnpm --filter @yayatoh/worker drill-tickets -- --org <staging org slug> --out ./drill
# optional: --starts 2026-10-01T17:00:00Z (defaults to now; the event runs 6 h) --timezone America/Chicago
```

It refuses to run with `NODE_ENV=production` or a payment provider other than `fake`. It creates:

| Item | Detail |
|---|---|
| Event | "Check-in drill <timestamp>", published, 6 h long |
| Checkpoints | North gate and South gate (entrances), VIP lounge (zone) |
| 265 valid tickets | Free "Drill pass" |
| 5 "unpaid" tickets | Paid with the fake provider, then refunded in full, so they are **void** |
| `drill/scan-plan.csv` | 300 scans: `seq, device (A/B/C), kind, expected, holder, code` |
| `drill/cards.html` | One QR card per planned scan, labelled `#seq · device · kind` |
| `drill/results.md` | The results template, pre-filled with the event id and the planned counts |

The plan: each valid ticket once (round-robin A → B → C); 20 of them again on the *next* device
(the cross-device duplicates); 10 invalid codes (5 with a tampered signature, 5 unknown short
codes); the 5 refunded tickets. Print `cards.html` (4 per row) and cut or fold them into three
piles, one per device.

## 2. Set up the devices (15 minutes)

1. On the laptop open the event's **Check-in** page (`/o/<org>/e/<event>/onsite`).
2. Under **Scanner devices**, add "Drill A", "Drill B", "Drill C". Each shows its key once and a
   setup link. Open each link on its phone (send it by AirDrop/Nearby Share, or type the key into
   `/scan` → "Set up this scanner" → "Start scanning").
3. On each phone check the header: **Online**, "270 tickets on this device", a recent "Updated".
4. Install the PWA (Share → Add to Home Screen on iOS; Install app on Android) and open it from
   the home screen once.
5. Optional (checkpoint scope, M1.9d): make a helper door staff at **North gate** only
   (**Manage door staff**), enroll one device **Handed to** them, and confirm its "Scanning at"
   list shows only North gate.
6. Each phone picks **Scanning at → North gate** (A), **South gate** (B), **North gate** (C).
7. Record each phone's model, OS, browser and battery in the results template.

## 3. Online warm-up and latency (10 minutes)

With Wi-Fi on, each device scans 10 cards from the *end* of its pile (valid ones), as fast as
it reasonably can, for about 20 scans/s across the three plus the laptop's HID scanner if you
have one. Then measure the online verdict latency:

- In the browser devtools of the laptop (or with the server logs / APM if the deployment has one),
  read the `POST /api/v1/scans/batch` and the door-screen scan action timings; p95 must be under
  300 ms. Note the numbers in the results template.

These 30 scans are part of the 300 (they are planned scans), so don't rescan them later.

## 4. The offline run (30 minutes)

1. **Turn Wi-Fi and mobile data off on all three phones** (airplane mode, Wi-Fi off). The header
   says **Offline**.
2. Scan the rest of each pile in order. Watch for:
   - valid cards → "Welcome in" ("will be confirmed when synced");
   - scanning the **same card twice on the same phone** (do it 3 times on purpose, not counted in
     the 300) → "Already checked in", never a second "Welcome in";
   - invalid cards → "Not a valid ticket"; refunded cards → "This ticket was cancelled" only if
     the phone synced after the refunds (it did in step 2), otherwise the server corrects it;
   - the duplicate cards → "Welcome in" on the second phone too (it can't know yet).
3. When all piles are done, note each phone's "n scans waiting to sync" — the three add up to the
   number of offline scans.

## 5. Reconnect and reconcile (5 minutes)

1. Start the stopwatch and turn Wi-Fi back on **on all three phones at once**.
2. Each phone drains its queue ("All scans synced") and shows "Confirmed by the server".
3. On the laptop's door screen (it refreshes every 10 s): the red panel **"20 tickets were let in twice
   while offline"** must list **20** tickets. Stop the stopwatch when the 20th appears; it must be
   **≤ 60 s** after reconnect.
4. The **things to check** panel may also show velocity signals if a helper scanned very fast
   (Scanning faster than a person can) — note them; that is the detector working.

## 6. Verify on the server (10 minutes)

Run against the staging database as `app_user` inside the org's tenant (or read the numbers from
the door screen and the fraud list). Replace `<event>` with the event id from `results.md`:

```sql
select result, count(*) from checkin.scans where event_id = '<event>' group by result order by 1;
select count(*) from checkin.admissions where event_id = '<event>' and undone_at is null;
-- same-device double admissions (must be 0):
select ticket_id, device_id, count(*) from checkin.scans
 where event_id = '<event>' and result = 'admitted' group by 1, 2 having count(*) > 1;
```

Expected: 300 scans in total (plus the deliberate same-device repeats, which are `duplicate`);
265 live admissions; 20 `duplicate_offline`; 10 `invalid`; 5 `void`; zero rows in the last query.

Manifest privacy: on one phone open the browser's devtools (or a desktop browser with the same
key) and fetch `/api/v1/events/<event>/manifest` with the device key: rows carry `emailHash`,
never an email address or a phone number.

## 7. Record and clean up

1. Fill in every row of `results.md` (pass/fail, measured values, incidents) and add it to the
   release notes / the owner inbox.
2. On the door screen **Wipe** then **Revoke** the three drill devices. Each phone shows "This
   scanner was wiped" within 30 s.
3. Archive the drill event (or leave it; it's staging).

## If something fails

| Symptom | Check |
|---|---|
| A phone never goes "Online" | The link opened in a different browser than the installed PWA; set it up again in the PWA. |
| Scans stuck "waiting to sync" | The device was revoked or wiped; the door screen shows its state. |
| Duplicates not flagged | Both scans were on the same phone (that's a local duplicate), or the clocks' corrected times are equal — note the device clock offsets in the results. |
| "This device isn't assigned to this event" | The device was handed to door staff with no role at this event; fix it under **Manage door staff**. |
| More than 60 s to flag | Note the queue depths and network; the door screen polls every 10 s until Ably realtime lands (owner account). |

Any failure of a pass criterion blocks M1.9 sign-off: file it with the results and the device notes.
