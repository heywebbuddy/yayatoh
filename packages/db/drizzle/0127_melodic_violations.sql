CREATE SCHEMA "gallery";
--> statement-breakpoint
CREATE TABLE "gallery"."items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"uploader_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"caption" text,
	"upload_id" uuid,
	"upload_key" text,
	"declared_bytes" bigint DEFAULT 0 NOT NULL,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"source_type" text,
	"width" integer,
	"height" integer,
	"video_provider" text,
	"video_id" text,
	"published_at" timestamp with time zone,
	"decided_by" text,
	CONSTRAINT "items_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "items_kind_check" CHECK (kind in ('photo', 'video')),
	CONSTRAINT "items_status_check" CHECK (status in ('uploading', 'pending', 'published')),
	CONSTRAINT "items_caption_length" CHECK (caption is null or length(btrim(caption)) between 1 and 280),
	CONSTRAINT "items_bytes_check" CHECK (declared_bytes >= 0 and bytes >= 0),
	CONSTRAINT "items_photo_check" CHECK (kind <> 'photo' or (upload_id is not null and upload_key ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/u-[0-9a-f]{32}$' and declared_bytes > 0 and video_provider is null and video_id is null and (status = 'uploading' or (source_type in ('jpeg', 'png', 'gif', 'webp', 'avif', 'heic') and width > 0 and height > 0)))),
	CONSTRAINT "items_video_check" CHECK (kind <> 'video' or (status <> 'uploading' and upload_id is null and upload_key is null and bytes = 0 and declared_bytes = 0 and ((video_provider = 'youtube' and video_id ~ '^[A-Za-z0-9_-]{11}$') or (video_provider = 'vimeo' and video_id ~ '^[0-9]{1,12}$')))),
	CONSTRAINT "items_published_check" CHECK ((status = 'published') = (published_at is not null))
);
--> statement-breakpoint
ALTER TABLE "gallery"."items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gallery"."items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "gallery"."settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"moderation" text DEFAULT 'hold' NOT NULL,
	"cap_bytes" bigint NOT NULL,
	"guest_quota_bytes" bigint NOT NULL,
	"guest_quota_items" integer NOT NULL,
	CONSTRAINT "settings_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "settings_moderation_check" CHECK (moderation in ('hold', 'auto')),
	CONSTRAINT "settings_cap_check" CHECK (cap_bytes > 0),
	CONSTRAINT "settings_guest_quota_check" CHECK (guest_quota_bytes > 0 and guest_quota_items > 0)
);
--> statement-breakpoint
ALTER TABLE "gallery"."settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gallery"."settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "gallery"."uploaders" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"display_name" text,
	"user_id" text,
	CONSTRAINT "uploaders_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "uploaders_kind_check" CHECK (kind in ('guest', 'host')),
	CONSTRAINT "uploaders_identity_check" CHECK ((kind = 'guest' and display_name is not null and length(btrim(display_name)) between 1 and 60 and user_id is null) or (kind = 'host' and user_id is not null))
);
--> statement-breakpoint
ALTER TABLE "gallery"."uploaders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gallery"."uploaders" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "gallery"."variants" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"item_id" uuid NOT NULL,
	"format" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"file_name" text NOT NULL,
	"fallback" boolean DEFAULT false NOT NULL,
	CONSTRAINT "variants_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "variants_format_check" CHECK (format in ('avif', 'webp', 'jpeg', 'png')),
	CONSTRAINT "variants_dimensions_check" CHECK (width > 0 and height > 0),
	CONSTRAINT "variants_sha256_check" CHECK (sha256 ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "variants_file_name_check" CHECK (file_name ~ '^[0-9]{1,5}-[0-9a-f]{32}\.(avif|webp|jpg|png)$')
);
--> statement-breakpoint
ALTER TABLE "gallery"."variants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gallery"."variants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gallery"."items" ADD CONSTRAINT "items_uploader_fk" FOREIGN KEY ("org_id","uploader_id") REFERENCES "gallery"."uploaders"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery"."variants" ADD CONSTRAINT "variants_item_fk" FOREIGN KEY ("org_id","item_id") REFERENCES "gallery"."items"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "items_org_id_idx" ON "gallery"."items" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "items_org_event_status_idx" ON "gallery"."items" USING btree ("org_id","event_id","status","published_at");--> statement-breakpoint
CREATE INDEX "items_org_uploader_idx" ON "gallery"."items" USING btree ("org_id","uploader_id");--> statement-breakpoint
CREATE INDEX "settings_org_id_idx" ON "gallery"."settings" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "settings_org_event_key" ON "gallery"."settings" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "uploaders_org_id_idx" ON "gallery"."uploaders" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "uploaders_org_event_idx" ON "gallery"."uploaders" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uploaders_org_event_host_key" ON "gallery"."uploaders" USING btree ("org_id","event_id","user_id") WHERE kind = 'host';--> statement-breakpoint
CREATE INDEX "variants_org_id_idx" ON "gallery"."variants" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "variants_org_item_file_key" ON "gallery"."variants" USING btree ("org_id","item_id","file_name");--> statement-breakpoint
CREATE POLICY "items_tenant_isolation" ON "gallery"."items" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "settings_tenant_isolation" ON "gallery"."settings" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "uploaders_tenant_isolation" ON "gallery"."uploaders" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "variants_tenant_isolation" ON "gallery"."variants" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- M4.5b: every gallery row belongs to one event of the org (composite FKs, cascade on event delete).
ALTER TABLE "gallery"."settings" ADD CONSTRAINT "settings_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "gallery"."uploaders" ADD CONSTRAINT "uploaders_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "gallery"."items" ADD CONSTRAINT "items_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;
-- hand-written: end
