# cms (tier 1)

Tenant CMS (M1.4g): an org's pages and blog posts. Owns Postgres schema `cms`.

**Tier:** 1, the roadmap's "content" slot (§3.5). It needs nothing from other modules: the
author is the acting member (`ctx.actor`) with a display-name snapshot from the console, so it
never reads tenancy. Higher tiers read it: marketplace (tier 6) validates the pages a tenant
site's navigation links and lists entries in sitemaps.

**Invariants**
- `entries` is a tenant table (RLS FORCE). One row is a `page` or a `post`; `slug` is unique per
  org and kind, lowercase ASCII (`a-z0-9` and single hyphens, ≤ 80), derived from the title
  with a `-2`, `-3` suffix when left empty, and **frozen once first published** (public URLs and
  sitemaps depend on it).
- `body` is the M1.4d Markdown subset (`@yayatoh/contracts` `sanitizeMarkdown` on every write,
  `parseMarkdown` → React elements on every render): raw HTML stays text, only http(s)/mailto
  links survive, control and bidi-override characters are stripped.
- Status: draft → published ⇄ draft, draft/published → archived, archived → published. Only
  `published` entries are ever read publicly (`publicEntries`, `publicEntry`, `navPages`,
  `sitemapEntries`), through allowlisted DTOs (no ids, no author account id).
- Writes need `marketing:write` (owner, admin, manager, marketing); reads need `org:read`
  (viewers read only). Every write is audited; publish/unpublish/archive/delete emit
  `cms.page_published@1` / `cms.post_published@1` / `cms.entry_unpublished@1` /
  `cms.entry_archived@1` / `cms.entry_deleted@1` (payload: org, entry id, kind, slug).
- **Hook (M1.4e):** cover images arrive with the media pipeline as a `cover_media_id` column
  and a `cover` field on the public DTOs; nothing stores images before then.
