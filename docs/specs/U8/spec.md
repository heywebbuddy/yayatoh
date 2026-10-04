# U8 — Categories, tags and the event-type picker

Approved plan: `docs/plans/ux-review-1.md` (UX-2, row U8). Brief: `docs/agent-briefs/u8.md`. Uses U1's controls (Select, Combobox).

The organizer asked "how do I add or remove an event type?". UX-2 keeps the **profiles** fixed: they are product modes that switch whole sections on and off. U8 adds what organizers want instead:
- the org's own **categories**
- free **tags** that filter everywhere
- a **"What kind of event?"** picker that says what each kind includes
- **staff control** of the default category list

## What was built
- **Platform default categories** (`events.platform_categories`):
  - A global reference table, one row per taxonomy key (`EVENT_CATEGORIES`). `in_defaults` and `position` decide which categories a new org starts with, and in what order.
  - It is seeded with the whole taxonomy. app_user may only read it.
  - Staff change it only through the SECURITY DEFINER `events.set_platform_default_categories(keys, actor)`, which needs a `staff:` actor, at least one key, known keys and no duplicates.
- **Org categories** (`events.org_categories`, tenant table, FORCE RLS):
  - Each row has a `platform_key`, an optional own `name` (null = the translated platform label), a `position` and a `hidden_at`.
  - Names are unique per org, case-insensitively, and an unchanged default appears once per key.
  - **Lazy seeding:** until an org changes its list, the query shows the platform defaults. The first change stores them (`ensureOrgCategoriesTx`). Keys that existing events use but the defaults leave out are kept, hidden. Existing events are linked to their category.
  - **Refs:** a category is addressed by its platform key while it is an unchanged default (`music`), else by its id. Old links and callers (`?category=music`, `category: 'music'`) keep working.
- **Commands** (`packages/modules/events/src/categories.ts`):
  - `addOrgCategory`, `renameOrgCategory`, `setOrgCategoryHidden` and `moveOrgCategory` (one step up or down: the keyboard alternative to dragging) need `org:update` (owners and admins).
  - `orgCategoriesQuery` (`events:read`) returns visible categories by default and every category with `includeHidden`, each with its event count.
  - Refusals: the last visible category can't be hidden, and an org can have at most 100 categories.
- **Events:**
  - `events.org_category_id` is a composite FK to the org's category. `events.category` stays the mapped platform key, so the marketplace and `/v1` keep the platform taxonomy.
  - `setEventDetails` takes `orgCategory` (a ref). A hidden category can't be newly picked but stays on the events that have it (like an archived venue).
  - The details DTO adds `categoryRef`, `categoryName` and `categoryHidden`.
  - `searchEventsQuery` filters by `categoryRef` and returns `categoryName`.
- **Tags:**
  - On the event's Details page the tag field is a U1 `Combobox`: chips, the org's tags as suggestions, and "Create …" on the fly. A tag that matches a chosen one in another case is not added twice. Without JavaScript a comma list still posts.
  - The console list's tag filter was already there (M1.4c).
  - **Org site:** `marketplace.public_listings` projects `tags` and `tag_keys`. The organizer page (`/o/{slug}`) and the tenant site home show tag chips (links with `aria-current`, 44 px targets). They filter by `?tag=`, and pagination keeps the tag. Cached under the org's scope.
  - **`/v1` (additive):** `Event` gains `tags` and `category`, and `GET /v1/orgs/{org}/events?tag=` filters the keyset list. `openapi.json` and the SDK are regenerated.
- **Console UI:**
  - **`/o/{org}/settings/categories`:** breadcrumb, a "How it works" panel, an add form with name and marketplace category, and the ordered list with move up/down, rename, hide/show and event counts. Status messages are polite live regions.
  - Settings links to it, and the event Details page has "Manage categories" for owners and admins.
  - The event Details picker and the console filter list the org's categories. Cards show the org's name for a category.
- **Profile picker:**
  - "What kind of event?" (a fieldset legend) holds the Event type `Select`, whose options carry a one-line description.
  - Below it, a summary of the chosen kind shows its description and the sections it includes for this org's modules (`profileSectionKeys`: build and run items in the profile's vocabulary, without the pages every event has).
  - It is used on the quick form and in the guided wizard.
- **Admin:** `/categories` (staff action `categories`, admins only) lists the taxonomy. Tick what's in the defaults and move items with buttons. Saving goes through the function above, and every view and save is in the access log. A change never alters a list an org already stored.

## Later / not yet
- **Public event page label:** it still shows the platform category label, not the org's own name (that needs a new version of the SECURITY DEFINER `events.public_event_v2`).
- **New platform taxonomy keys:** these need a code change (13 locales, the `/v1` enum, CHECK constraints). Staff choose and order the existing keys.
- **Deleting org categories:** not offered (hide keeps history). Rename back to the platform label: not offered (rename again instead).
- **Sidebar entry:** the page sits under Settings (`settings/categories`). U2's grouped navigation can add a direct item when it merges.

## Acceptance
| Criterion | Test |
|---|---|
| Add, rename, hide, reorder, seeded from platform defaults | `packages/testing/tests/categories-tags.int.test.ts`; `apps/web/e2e/categories-tags.spec.ts` (owners add, rename…; keyboard only) |
| A hidden category disappears from pickers but keeps history | `categories-tags.int.test.ts` (hidden category …); e2e "a hidden category stays on its events" |
| Marketplace keeps mapping to platform categories | int "platform keys still work" (event keeps `category`); e2e rename shows "Marketplace: Music" |
| Staff manage the platform default list | `apps/admin/tests/platform-categories.int.test.ts`; `apps/admin/tests/staff-roles.test.ts`; `apps/admin/e2e/categories.spec.ts` |
| Tags created on the fly with the Combobox | e2e "tag an event with the combobox"; e2e keyboard tags; `apps/web/e2e/venues.spec.ts` |
| Tag filters: console, public site, `/v1` | e2e (console + organizer page + Arabic); int `orgListings`/`orgListingTags`; `packages/api-v1/tests/tags.int.test.ts` |
| Tags never leak across orgs | `categories-tags.int.test.ts` (B sees nothing by any path); `tags.int.test.ts`; e2e (Harbor's site) |
| Profile picker with descriptions and sections | `apps/web/tests/profile-picker.test.ts`; e2e "what kind of event?" (quick form and wizard) |
| Permissions | int (viewer refused, other org not found); e2e viewer: no link, 404 on the URL |
| Keyboard only, axe in both themes, RTL | e2e: keyboard tests, `expectAccessibleBothModes`, Arabic pages |
