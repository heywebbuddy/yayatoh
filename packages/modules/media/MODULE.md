# media (tier 3)

Uploaded images: event cover and gallery, venue photos, the org logo (M1.4e). Owns Postgres schema `media`.

**Invariants**
- An upload is what its **bytes** are (magic-byte sniffing): JPEG, PNG, GIF, WebP, AVIF or SVG. The file name and Content-Type are never trusted. At most 10 MB (SVG 1 MB) and 40 megapixels.
- Nothing is served as uploaded. Rasters are decoded (first frame), auto-oriented and **re-encoded** to AVIF and WebP at the standard widths (320/640/1280/1920, never enlarged) plus one PNG/JPEG fallback (≤1280 px) for email and OG images; encoders write no metadata, so EXIF/GPS, XMP, IPTC and ICC never survive. SVGs are **sanitized** to an allowlisted subset (no script, handlers, `javascript:`, `foreignObject`, animation, external references, DOCTYPE/entities) and also rasterized from the sanitized document.
- `media.assets` / `media.variants` are tenant rows (FORCE RLS). Alt text is required unless the image is marked decorative (CHECK). `cover` and `logo` hold one image; `gallery` and `photo` at most 20.
- Files live in the `MediaStore` port under `{org}/{asset}/{width}-{sha256[:32]}.{ext}` (content-hashed, immutable). Adapters: `postgres` (dev/CI, `media.blobs`) and `r2` (production; owner inbox). Every store call names the org and refuses keys outside its prefix.
- Uploads count against the org's quota (`media.quotas`, default 1 GiB) under a per-org advisory lock; a replacement's old bytes don't count twice. Removing or replacing an image deletes its rows in the command and its files right after commit; a failed upload's files are purged.
- Permissions: event and venue images need `events:write`; the logo needs `org:update` (it also sets `tenancy.organizations.logo_path/logo_alt` through tenancy's `setOrganizationLogoTx`). Every member may list.
- Public reads only through the SECURITY DEFINER functions `media.public_media`, `media.public_covers` and `media.serve_target` (via `media.owner_visibility`): event images while the event has a public page (private events only with an access grant the server checked), venue photos of listed live venues, the logo of an active org. Output is allowlisted (`PublicMediaDto`).
- Events emitted: `media.asset_added@1`, `media.asset_removed@1`.
