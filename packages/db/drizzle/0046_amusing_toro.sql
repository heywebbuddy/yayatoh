CREATE SCHEMA "media";
--> statement-breakpoint
CREATE TABLE "media"."assets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"slot" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"source_type" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"alt" text,
	"decorative" boolean DEFAULT false NOT NULL,
	"bytes" bigint NOT NULL,
	"created_by" uuid,
	CONSTRAINT "assets_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "assets_owner_type_check" CHECK (owner_type in ('event', 'venue', 'org')),
	CONSTRAINT "assets_slot_check" CHECK (slot in ('cover', 'gallery', 'photo', 'logo')),
	CONSTRAINT "assets_owner_slot_check" CHECK ((owner_type = 'event' and slot in ('cover', 'gallery')) or (owner_type = 'venue' and slot = 'photo') or (owner_type = 'org' and slot = 'logo' and owner_id = org_id)),
	CONSTRAINT "assets_source_type_check" CHECK (source_type in ('jpeg', 'png', 'gif', 'webp', 'avif', 'svg')),
	CONSTRAINT "assets_dimensions_check" CHECK (width > 0 and height > 0),
	CONSTRAINT "assets_bytes_check" CHECK (bytes >= 0),
	CONSTRAINT "assets_alt_check" CHECK (decorative or (alt is not null and length(btrim(alt)) between 1 and 300)),
	CONSTRAINT "assets_position_check" CHECK (position >= 0)
);
--> statement-breakpoint
ALTER TABLE "media"."assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "media"."assets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "media"."blobs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"key" text NOT NULL,
	"content_type" text NOT NULL,
	"data" "bytea" NOT NULL,
	CONSTRAINT "blobs_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "blobs_key_prefix_check" CHECK (starts_with(key, org_id::text || '/'))
);
--> statement-breakpoint
ALTER TABLE "media"."blobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "media"."blobs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "media"."quotas" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"bytes_limit" bigint NOT NULL,
	CONSTRAINT "quotas_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "quotas_bytes_limit_check" CHECK (bytes_limit >= 0)
);
--> statement-breakpoint
ALTER TABLE "media"."quotas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "media"."quotas" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "media"."variants" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"asset_id" uuid NOT NULL,
	"format" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"file_name" text NOT NULL,
	"fallback" boolean DEFAULT false NOT NULL,
	CONSTRAINT "variants_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "variants_format_check" CHECK (format in ('avif', 'webp', 'jpeg', 'png', 'svg')),
	CONSTRAINT "variants_dimensions_check" CHECK (width > 0 and height > 0),
	CONSTRAINT "variants_sha256_check" CHECK (sha256 ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "variants_file_name_check" CHECK (file_name ~ '^[0-9]{1,5}-[0-9a-f]{32}\.(avif|webp|jpg|png|svg)$')
);
--> statement-breakpoint
ALTER TABLE "media"."variants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "media"."variants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenancy"."organizations" ADD COLUMN "logo_path" text;--> statement-breakpoint
ALTER TABLE "tenancy"."organizations" ADD COLUMN "logo_alt" text;--> statement-breakpoint
ALTER TABLE "media"."variants" ADD CONSTRAINT "variants_asset_fk" FOREIGN KEY ("org_id","asset_id") REFERENCES "media"."assets"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_org_id_idx" ON "media"."assets" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "assets_org_owner_idx" ON "media"."assets" USING btree ("org_id","owner_type","owner_id","slot","position");--> statement-breakpoint
CREATE UNIQUE INDEX "assets_org_single_slot_key" ON "media"."assets" USING btree ("org_id","owner_type","owner_id","slot") WHERE slot in ('cover', 'logo');--> statement-breakpoint
CREATE INDEX "blobs_org_id_idx" ON "media"."blobs" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "blobs_org_key_key" ON "media"."blobs" USING btree ("org_id","key");--> statement-breakpoint
CREATE INDEX "quotas_org_id_idx" ON "media"."quotas" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quotas_org_key" ON "media"."quotas" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "variants_org_id_idx" ON "media"."variants" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "variants_org_asset_file_key" ON "media"."variants" USING btree ("org_id","asset_id","file_name");--> statement-breakpoint
-- hand-written: begin (existing table: NOT VALID + VALIDATE keeps the lock short; every existing row has no logo)
ALTER TABLE "tenancy"."organizations" ADD CONSTRAINT "organizations_logo_check" CHECK ((logo_path is null and logo_alt is null) or (logo_path ~ '^/media/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9]{1,5}-[0-9a-f]{32}[.](png|jpg)$' and length(btrim(logo_alt)) between 1 and 300)) NOT VALID;--> statement-breakpoint
ALTER TABLE "tenancy"."organizations" VALIDATE CONSTRAINT "organizations_logo_check";--> statement-breakpoint
-- hand-written: end
CREATE POLICY "assets_tenant_isolation" ON "media"."assets" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "blobs_tenant_isolation" ON "media"."blobs" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "quotas_tenant_isolation" ON "media"."quotas" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "variants_tenant_isolation" ON "media"."variants" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin (M1.4e: media public read paths; allowlisted columns, SECURITY DEFINER)
-- Who may see an owner's images: 'public' (anyone), 'private_event' (a live private event: only a
-- visitor whose access grant the server checked), or 'none' (members of the org only).
CREATE FUNCTION media.owner_visibility(p_org uuid, p_owner_type text, p_owner_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM tenancy.organizations o WHERE o.id = p_org AND o.status IN ('active', 'limited'))
      THEN 'none'
    WHEN p_owner_type = 'org' THEN CASE WHEN p_owner_id = p_org THEN 'public' ELSE 'none' END
    WHEN p_owner_type = 'venue' THEN coalesce((
      SELECT 'public' FROM venues.venues v
      WHERE v.org_id = p_org AND v.id = p_owner_id AND v.directory_listed AND v.archived_at IS NULL), 'none')
    WHEN p_owner_type = 'event' THEN coalesce((
      SELECT CASE
        WHEN e.status IN ('published', 'postponed', 'cancelled', 'completed') AND e.visibility IN ('public', 'unlisted')
          THEN 'public'
        WHEN e.status IN ('published', 'postponed') AND e.visibility = 'private' THEN 'private_event'
        ELSE 'none' END
      FROM events.events e WHERE e.org_id = p_org AND e.id = p_owner_id), 'none')
    ELSE 'none' END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION media.owner_visibility(uuid, text, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION media.owner_visibility(uuid, text, uuid) TO app_user;--> statement-breakpoint
-- The images of one owner, for its public page (`p_private_ok`: the server checked an access grant).
CREATE FUNCTION media.public_media(p_owner_type text, p_owner_id uuid, p_private_ok boolean)
RETURNS TABLE (
  org_id uuid, asset_id uuid, owner_id uuid, slot text, "position" integer, width integer, height integer,
  alt text, decorative boolean, variants jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT a.org_id, a.id, a.owner_id, a.slot, a.position, a.width, a.height, a.alt, a.decorative,
         (SELECT jsonb_agg(jsonb_build_object('format', v.format, 'width', v.width, 'height', v.height,
                                              'file_name', v.file_name, 'fallback', v.fallback))
          FROM media.variants v WHERE v.org_id = a.org_id AND v.asset_id = a.id)
  FROM media.assets a
  WHERE a.owner_type = p_owner_type AND a.owner_id = p_owner_id
    AND media.owner_visibility(a.org_id, a.owner_type, a.owner_id) = ANY (
      CASE WHEN p_private_ok THEN ARRAY['public', 'private_event'] ELSE ARRAY['public'] END)
  ORDER BY a.slot, a.position
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION media.public_media(text, uuid, boolean) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION media.public_media(text, uuid, boolean) TO app_user;--> statement-breakpoint
-- Cover images of public events by slug (listing cards across orgs).
CREATE FUNCTION media.public_covers(p_event_slugs text[])
RETURNS TABLE (
  org_id uuid, asset_id uuid, owner_id uuid, slot text, "position" integer, width integer, height integer,
  alt text, decorative boolean, variants jsonb, event_slug text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT a.org_id, a.id, a.owner_id, a.slot, a.position, a.width, a.height, a.alt, a.decorative,
         (SELECT jsonb_agg(jsonb_build_object('format', v.format, 'width', v.width, 'height', v.height,
                                              'file_name', v.file_name, 'fallback', v.fallback))
          FROM media.variants v WHERE v.org_id = a.org_id AND v.asset_id = a.id),
         e.slug
  FROM events.events e
  JOIN media.assets a ON a.org_id = e.org_id AND a.owner_type = 'event' AND a.owner_id = e.id AND a.slot = 'cover'
  WHERE e.slug = ANY (p_event_slugs[1:500])
    AND media.owner_visibility(a.org_id, 'event', a.owner_id) = 'public'
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION media.public_covers(text[]) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION media.public_covers(text[]) TO app_user;--> statement-breakpoint
-- What /media/{org}/{asset}/{file} points at (metadata only; the server decides and reads the bytes).
CREATE FUNCTION media.serve_target(p_org uuid, p_asset uuid, p_file text)
RETURNS TABLE (format text, bytes integer, sha256 text, owner_type text, owner_id uuid, visibility text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT v.format, v.bytes, v.sha256, a.owner_type, a.owner_id,
         media.owner_visibility(a.org_id, a.owner_type, a.owner_id)
  FROM media.variants v
  JOIN media.assets a ON a.org_id = v.org_id AND a.id = v.asset_id
  WHERE v.org_id = p_org AND v.asset_id = p_asset AND v.file_name = p_file
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION media.serve_target(uuid, uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION media.serve_target(uuid, uuid, text) TO app_user;
-- hand-written: end
