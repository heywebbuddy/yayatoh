# Client feedback backlog

Source: the client's feedback document `E:\yaytoh feedback.docx` (37 points, 13 screenshots).
Status is from QA round 4 on `qa-integration` (production build, database `yayatoh_qa4`, real Anthropic key). Evidence is in `docs/qa/integration-report.md` (round 4).

Legend: [x] done and verified in the app · [~] partial, or built but not verified yet · [ ] not done
Owners: **B1** buying, seating & tickets · **B2** organizer setup & content · **B3** redesign, AI & tours · **QA**
Branches: `claude/batch-1-buying-39fe1a`, `claude/batch-2-setup-59fe0b`, `claude/batch-3-redesign-664a1d`, combined in `qa-integration`. Nothing is on `main` or Railway yet.

## Client points

| # | Client point | Status | Owner | Notes |
|---|---|---|---|---|
| 1 | Venue description and contact (email, phone) | [x] | B2 | Also website; the venue's country sets its time zone |
| 2 | Add a new venue from the event wizard | [x] | B2 | Inline form; round 4: picking a saved venue sets the wizard time zone (Kolkata for Skyline Studio) |
| 3 | Content editing too basic | [x] | B2 | Row editors, live preview, text toolbar, day headings |
| 4 | Select 1 seat or buy the entire table | [x] | B1 | "Select whole table"; QA bought a table of 10 |
| 5 | Checkout | [x] | B1 | Free, paid, seated, whole table, multi-date and tour all complete |
| 6 | Organizers can add DJ, MC, artists, speakers, influencers | [x] | B2 | Round 4: role list shows "Host / MC", DJ, Artist / Performer, Influencer; the public page has "Hosts / MCs" etc. (QA's own scripted add picked the wrong role by mistake, not a product bug) |
| 7 | Video background in the hero | [x] | B3 | Round 4: uploaded a WebM (with poster) as the hero video; it plays behind the title. YouTube link embeds too. MP4 itself not tried (no MP4 on this machine) |
| 8 | Table number on the customer seat map | [x] | B1 | Dark seat map too |
| 9 | (screenshot only) | n/a | | |
| 10 | Video overviews on the event page | [x] | B2/B3 | Round 4: added a Video section in the editor with an uploaded WebM + poster; it shows on the public page with controls. The editor's live preview says "Nothing to preview yet" for it (minor) |
| 11 | Multi-day tickets; re-entry after X hours | [x] | B1 | Re-entry window of 1–72 h; next-day check-in tested |
| 12 | Airplane style: a seat per day or leg | [x] | B1 | Round 4: on City Hopper Express bought one seat per date (Row B·3 Nov 16, Row C·5 Nov 23, Row A·7 Nov 30), $120, 3 tickets each with its own date and seat |
| 13 | Attendee chat | [x] | B2 | Lobby chat between two attendees tested; 1:1 chat after a connection |
| 14 | Total before paying; no forced sign-in | [x] | B1 | Live order summary; "No account needed" |
| 15 | Landing pages: organizations, weddings, galas, conferences | [x] | B3 | `/solutions/*` |
| 16 | Event creation intuitive, more design options | [x] | B2/B3 | Wizard, Create with AI, theme / font / hero layout |
| 17 | Frontend basic; missing features | [x] | B3 | Public site redesigned |
| 18 | Sponsor detail pages; visibility by package | [x] | B2 | Contact, video, team, brochure; richer demo data added |
| 19 | Keynote speakers, artists, public figures | [x] | B2 | Roles plus "featured" |
| 20 | Simple bus or boat tour | [x] | B3 | Tour type; pickup point chosen at checkout; QA bought one |
| 21 | Blog posts on the website | [x] | B2 | Organizations manage their own blog (QA published one) |
| 22 | Share or distribute tickets via WhatsApp | [x] | B1 | Event page and the order's send-tickets form |
| 23 | Manage users | [x] | — | Team page; QA sent an invitation and the email arrived; accepting it not tested |
| 24 | On-page SEO | [x] | B2 | SEO title, description, URL with redirect, share image |
| 25 | AI event setup and chat assistant | [~] | B3 | Round 4, real key: Create with AI (wedding, conference, concert, tour) A- to A; tagline, description and FAQ drafts good; assistant answers single and two-part questions with sources and says it cannot find unknown facts. **Campaign "Draft with AI" used a credit but did not fill the editor in my run** (recheck by hand) |
| 26 | Check in with the same ticket twice | [x] | B1 | Refused the same day; admitted the next valid day |
| 27 | Organizer access to the attendee portal | [x] | B2 | "Preview attendee portal" (a mock: links are inactive) |
| 28 | Change an individual user's table/seat | [x] | B1 | "Change seat"; a swap was completed in the UI |
| 29 | Max attendees per event | [x] | B1 | Event-wide limit for checkout and box office |
| 30 | Competitor features (Cvent, RainFocus) | ref | PM | Summary in the QA report |
| 31 | (screenshot only) | n/a | | |
| 32 | Ticket shows date, time, owner, purchaser, type, group | [x] | B1 | Order cards and PDF |
| 33 | Bulk tickets to one person, who sends them by email, SMS, WhatsApp | [~] | B1 | Round 4: submitted "Who is coming?" with two guests; both emails delivered; the mobile-number field exists; **SMS delivery waits for the Twilio account** |
| 34 | End user sees and downloads their invoice | [x] | B1 | Receipt page and PDF for every paid order |
| 35 | Event-goers chat with each other | [x] | B2 | See 13 |
| 36 | Overall redesign | [x] | B3 | Public pages redesigned; the console stays in the old light design |
| 37 | Bulk download gives a separate file per ticket | [x] | B1 | ZIP with one PDF per ticket; a combined PDF is still available |

## Added by you after the feedback document

| Item | Status | Owner |
|---|---|---|
| Dribbble-style design, hero equalizer animation, Framer Motion | [x] | B3 |
| Sign-in and sign-up pages in the new design | [x] | B3 |
| Categories by our event types on the home page | [x] | B3 |
| Demo events with real images | [x] | B3 |
| Every public page in the new design | [~] | B3 (all pages fetched are new design and fit at 320 px with 0 CSP errors in production; `/help`, `/features`, `/contact`, `/blogs` only load when a marketplace content org exists: set `MARKETPLACE_CONTENT_ORG`, otherwise 404) |
| Home page sections: blog, testimonials, how it works, features, stats, FAQ, CTA | [x] | B3 (all sections present; a testimonial and post added in admin appear on home) |
| Each organization sees only its own revenue | [x] | B1 (test with two orgs; net = gross − refunds − fees) |
| Upload video for hero and video sections | [x] | B3 (stored on our own origin, not S3; WebM tested, MP4 not) |
| Platform blog, testimonials and home hero managed from the admin panel | [x] | B2 (QA published a post and a testimonial in the staff console on :3141; both are live on `/blogs` and home) |
| Demo blog posts and testimonials (admin and organization) | [x] | B2 (demo-content script ran; `/blogs` and `/organizers/webbuddy/blogs` show them) |
| Affiliate program | [ ] | not built; only marketing link tracking exists |

## Bugs from QA

| Bug | Status |
|---|---|
| B01 venue/event time zone stuck on New York | [x] venue form and wizard both fixed (round 4) |
| B02 multi-date ticket shows the whole series range | [x] order page of the 3-date purchase shows each booked date (claim page not rechecked) |
| B04 password sign-in doesn't move on | [x] |
| B05 "Continue to payment" on free orders | [x] the email-code panel is now clear and scrolls into view ("Quick email check"); free-ticket button label not rechecked |
| B06 "place your order" on sign-in | [x] |
| B07 "Table Table 1" | [x] |
| B08 "find your seat" on non-seated tickets | [x] |
| B09 "Good morning, ." with no name | [x] console says "Good morning, ratnesh." |
| B10 2FA status stale | [x] |
| B11 net equals gross | [x] not a bug (the demo orders have no fees) |
| B12 blank event cards | [x] |
| B13 AI draft quality | [x] real AI is good (round 4) |
| B14 event type defaults to Agency | [x] |
| N1 networking-page sign-in | [x] |
| N2 phone overflow | [x] |
| N3 CSP errors in production | [x] |
| N4 /help, /features, /contact, /blogs 404 | [~] load once `MARKETPLACE_CONTENT_ORG` is set; without it (or the default `harbor-arts` org) they still 404 |
| N6 checked-in ticket shows "Valid" | [x] console order shows "Checked in" |
| R1 column-privacy unit test | [ ] `seat_legs` fixed, but `events.speakers.bio` is now undeclared; also 430 notification render snapshots are stale ("Hello," became "Hello!") |
| R2 tokens unit test | [x] |
| R3 hero video 0 × 0 | [x] the uploaded video fills the hero (screenshot) |

## Needs you

- [x] Final QA round approved (round 4 done; see the report)
- [x] Anthropic key added to `.env.local` (expires in a day)
- [ ] Twilio account, to test SMS
- [ ] Real client testimonials and logos (demo content until then)
- [ ] Approval to merge `qa-integration` into `main` and deploy to Railway after round 4
