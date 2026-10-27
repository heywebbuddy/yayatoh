CREATE TABLE "events"."event_slug_redirects" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"old_slug" text NOT NULL,
	CONSTRAINT "event_slug_redirects_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "event_slug_redirects_format_check" CHECK (old_slug ~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$')
);
--> statement-breakpoint
ALTER TABLE "events"."event_slug_redirects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "events"."event_slug_redirects" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "media"."assets" DROP CONSTRAINT "assets_slot_check";--> statement-breakpoint
ALTER TABLE "media"."assets" DROP CONSTRAINT "assets_owner_slot_check";--> statement-breakpoint
DROP INDEX "media"."assets_org_single_slot_key";--> statement-breakpoint
ALTER TABLE "events"."events" ADD COLUMN "seo_title" text;--> statement-breakpoint
ALTER TABLE "events"."events" ADD COLUMN "seo_description" text;--> statement-breakpoint
ALTER TABLE "events"."event_slug_redirects" ADD CONSTRAINT "event_slug_redirects_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_slug_redirects_org_id_idx" ON "events"."event_slug_redirects" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_slug_redirects_old_slug_key" ON "events"."event_slug_redirects" USING btree ("old_slug");--> statement-breakpoint
CREATE INDEX "event_slug_redirects_org_event_idx" ON "events"."event_slug_redirects" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assets_org_single_slot_key" ON "media"."assets" USING btree ("org_id","owner_type","owner_id","slot") WHERE slot in ('cover', 'logo', 'social');--> statement-breakpoint
ALTER TABLE "events"."events" ADD CONSTRAINT "events_seo_title_check" CHECK (seo_title is null or char_length(seo_title) between 1 and 70);--> statement-breakpoint
ALTER TABLE "events"."events" ADD CONSTRAINT "events_seo_description_check" CHECK (seo_description is null or char_length(seo_description) between 1 and 200);--> statement-breakpoint
ALTER TABLE "media"."assets" ADD CONSTRAINT "assets_slot_check" CHECK (slot in ('cover', 'gallery', 'photo', 'logo', 'floorplan', 'library', 'social'));--> statement-breakpoint
ALTER TABLE "media"."assets" ADD CONSTRAINT "assets_owner_slot_check" CHECK ((owner_type = 'event' and slot in ('cover', 'gallery', 'floorplan', 'social')) or (owner_type = 'venue' and slot = 'photo') or (owner_type = 'org' and slot = 'logo' and owner_id = org_id) or (owner_type = 'speaker' and slot = 'photo') or (owner_type in ('exhibitor', 'sponsor') and slot = 'logo') or (owner_type = 'library' and slot = 'library' and owner_id = org_id));--> statement-breakpoint
CREATE POLICY "event_slug_redirects_tenant_isolation" ON "events"."event_slug_redirects" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));
--> statement-breakpoint
-- hand-written: begin (old event addresses: the current slug of a public or unlisted event)
CREATE FUNCTION events.slug_redirect(p_slug text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT e.slug
  FROM events.event_slug_redirects r
  JOIN events.events e ON e.org_id = r.org_id AND e.id = r.event_id
  JOIN tenancy.organizations o ON o.id = e.org_id AND o.status IN ('active', 'limited')
  WHERE r.old_slug = lower(p_slug)
    AND e.status IN ('published', 'postponed', 'cancelled', 'completed')
    AND e.visibility IN ('public', 'unlisted')
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION events.slug_redirect(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION events.slug_redirect(text) TO app_user;
-- hand-written: end
