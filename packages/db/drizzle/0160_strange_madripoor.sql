CREATE TABLE "cms"."contact_pages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"intro" text,
	CONSTRAINT "contact_pages_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "contact_pages_intro_check" CHECK (intro is null or char_length(intro) between 1 and 500)
);
--> statement-breakpoint
ALTER TABLE "cms"."contact_pages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cms"."contact_pages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notifications"."email_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"from_name" text,
	"reply_to" text,
	"updated_by" uuid,
	CONSTRAINT "email_settings_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "email_settings_from_name_check" CHECK (from_name is null or (char_length(from_name) between 1 and 80 and from_name !~ '[@<>"\r\n]')),
	CONSTRAINT "email_settings_reply_to_check" CHECK (reply_to is null or (reply_to = lower(reply_to) and char_length(reply_to) between 3 and 254))
);
--> statement-breakpoint
ALTER TABLE "notifications"."email_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications"."email_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "media"."assets" DROP CONSTRAINT "assets_owner_type_check";--> statement-breakpoint
ALTER TABLE "media"."assets" DROP CONSTRAINT "assets_slot_check";--> statement-breakpoint
ALTER TABLE "media"."assets" DROP CONSTRAINT "assets_owner_slot_check";--> statement-breakpoint
ALTER TABLE "cms"."contact_requests" ADD COLUMN "source" text DEFAULT 'marketplace' NOT NULL;--> statement-breakpoint
ALTER TABLE "cms"."contact_requests" ADD COLUMN "submission_key" uuid;--> statement-breakpoint
ALTER TABLE "media"."assets" ADD COLUMN "source_asset_id" uuid;--> statement-breakpoint
CREATE INDEX "contact_pages_org_id_idx" ON "cms"."contact_pages" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_pages_org_key" ON "cms"."contact_pages" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "email_settings_org_id_idx" ON "notifications"."email_settings" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_settings_org_key" ON "notifications"."email_settings" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_requests_org_submission_key" ON "cms"."contact_requests" USING btree ("org_id","submission_key") WHERE submission_key is not null;--> statement-breakpoint
CREATE INDEX "assets_org_source_idx" ON "media"."assets" USING btree ("org_id","source_asset_id") WHERE source_asset_id is not null;--> statement-breakpoint
-- hand-written: begin (U10: constraints on existing tables (media.assets, cms.contact_requests) are added NOT VALID, then validated)
ALTER TABLE "media"."assets" ADD CONSTRAINT "assets_source_fk" FOREIGN KEY ("org_id","source_asset_id") REFERENCES "media"."assets"("org_id","id") ON DELETE restrict ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "media"."assets" VALIDATE CONSTRAINT "assets_source_fk";--> statement-breakpoint
ALTER TABLE "cms"."contact_requests" ADD CONSTRAINT "contact_requests_source_check" CHECK (source in ('marketplace', 'org_site')) NOT VALID;--> statement-breakpoint
ALTER TABLE "cms"."contact_requests" VALIDATE CONSTRAINT "contact_requests_source_check";--> statement-breakpoint
ALTER TABLE "media"."assets" ADD CONSTRAINT "assets_source_check" CHECK (source_asset_id is null or (source_asset_id <> id and bytes = 0 and owner_type <> 'library')) NOT VALID;--> statement-breakpoint
ALTER TABLE "media"."assets" VALIDATE CONSTRAINT "assets_source_check";--> statement-breakpoint
ALTER TABLE "media"."assets" ADD CONSTRAINT "assets_owner_type_check" CHECK (owner_type in ('event', 'venue', 'org', 'speaker', 'exhibitor', 'sponsor', 'library')) NOT VALID;--> statement-breakpoint
ALTER TABLE "media"."assets" VALIDATE CONSTRAINT "assets_owner_type_check";--> statement-breakpoint
ALTER TABLE "media"."assets" ADD CONSTRAINT "assets_slot_check" CHECK (slot in ('cover', 'gallery', 'photo', 'logo', 'floorplan', 'library')) NOT VALID;--> statement-breakpoint
ALTER TABLE "media"."assets" VALIDATE CONSTRAINT "assets_slot_check";--> statement-breakpoint
ALTER TABLE "media"."assets" ADD CONSTRAINT "assets_owner_slot_check" CHECK ((owner_type = 'event' and slot in ('cover', 'gallery', 'floorplan')) or (owner_type = 'venue' and slot = 'photo') or (owner_type = 'org' and slot = 'logo' and owner_id = org_id) or (owner_type = 'speaker' and slot = 'photo') or (owner_type in ('exhibitor', 'sponsor') and slot = 'logo') or (owner_type = 'library' and slot = 'library' and owner_id = org_id)) NOT VALID;--> statement-breakpoint
ALTER TABLE "media"."assets" VALIDATE CONSTRAINT "assets_owner_slot_check";--> statement-breakpoint
-- hand-written: end
CREATE POLICY "contact_pages_tenant_isolation" ON "cms"."contact_pages" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "email_settings_tenant_isolation" ON "notifications"."email_settings" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin (U10: what /media/{org}/{asset}/{file} points at, now with the asset whose
-- files hold the bytes: a library reuse names its original's files, nothing is stored twice.
-- Library images (owner `library`) are 'none' through media.owner_visibility: members only.
-- serve_target_v2 stays until the contract step.)
CREATE FUNCTION media.serve_target_v3(p_org uuid, p_asset uuid, p_file text)
RETURNS TABLE (format text, bytes integer, sha256 text, owner_type text, owner_id uuid, visibility text, event_id uuid, slot text, storage_asset_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT v.format, v.bytes, v.sha256, a.owner_type, a.owner_id,
         media.owner_visibility(a.org_id, a.owner_type, a.owner_id),
         media.owner_event(a.org_id, a.owner_type, a.owner_id), a.slot,
         coalesce(a.source_asset_id, a.id)
  FROM media.variants v
  JOIN media.assets a ON a.org_id = v.org_id AND a.id = v.asset_id
  WHERE v.org_id = p_org AND v.asset_id = p_asset AND v.file_name = p_file
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION media.serve_target_v3(uuid, uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION media.serve_target_v3(uuid, uuid, text) TO app_user;
-- hand-written: end
