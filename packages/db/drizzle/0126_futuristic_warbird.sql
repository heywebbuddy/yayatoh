CREATE TABLE "guests"."site_blocks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"heading" text,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "site_blocks_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "site_blocks_kind_check" CHECK (kind in ('text', 'program', 'travel', 'registry', 'faq')),
	CONSTRAINT "site_blocks_heading_length" CHECK (heading is null or length(heading) between 1 and 120),
	CONSTRAINT "site_blocks_position_check" CHECK (position >= 0),
	CONSTRAINT "site_blocks_content_check" CHECK (jsonb_typeof(content) = 'object')
);
--> statement-breakpoint
ALTER TABLE "guests"."site_blocks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guests"."site_blocks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "guests"."sites" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"code" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"title" text NOT NULL,
	"intro" text,
	"content_locale" text DEFAULT 'en' NOT NULL,
	"password_hash" text,
	"password_version" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "sites_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "sites_code_check" CHECK (code ~ '^[0-9A-Z]{8}$'),
	CONSTRAINT "sites_status_check" CHECK (status in ('draft', 'published')),
	CONSTRAINT "sites_title_length" CHECK (length(title) between 1 and 120),
	CONSTRAINT "sites_intro_length" CHECK (intro is null or length(intro) between 1 and 1000),
	CONSTRAINT "sites_locale_check" CHECK (content_locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
	CONSTRAINT "sites_password_hash_check" CHECK (password_hash is null or password_hash ~ '^scrypt\$16384\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$'),
	CONSTRAINT "sites_password_version_check" CHECK (password_version >= 0),
	CONSTRAINT "sites_published_check" CHECK (status <> 'published' or (password_hash is not null and published_at is not null))
);
--> statement-breakpoint
ALTER TABLE "guests"."sites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guests"."sites" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guests"."site_blocks" ADD CONSTRAINT "site_blocks_site_fk" FOREIGN KEY ("org_id","site_id") REFERENCES "guests"."sites"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "site_blocks_org_id_idx" ON "guests"."site_blocks" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "site_blocks_org_site_idx" ON "guests"."site_blocks" USING btree ("org_id","site_id","position");--> statement-breakpoint
CREATE INDEX "sites_org_id_idx" ON "guests"."sites" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sites_org_event_key" ON "guests"."sites" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sites_code_key" ON "guests"."sites" USING btree ("code");--> statement-breakpoint
CREATE POLICY "site_blocks_tenant_isolation" ON "guests"."site_blocks" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "sites_tenant_isolation" ON "guests"."sites" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- M4.5a cross-module composite FKs (guests is tier 3, events tier 2): an event's guest website and
-- its blocks belong to one event of the org; the event takes them with it.
ALTER TABLE "guests"."sites" ADD CONSTRAINT "sites_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "guests"."site_blocks" ADD CONSTRAINT "site_blocks_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
-- The guest website's address: code → org and event, only while the site is published and the
-- org is live. Ids only; nothing about the site's content, its password or the guests.
CREATE FUNCTION guests.site_target(p_code text)
RETURNS TABLE (org_id uuid, event_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT s.org_id, s.event_id FROM guests.sites s
  JOIN tenancy.organizations o ON o.id = s.org_id AND o.status IN ('active', 'limited')
  WHERE s.code = p_code AND s.status = 'published'
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION guests.site_target(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION guests.site_target(text) TO app_user;
-- hand-written: end
