CREATE TABLE "donations"."screens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"show_names" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "screens_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "screens_version_check" CHECK (version >= 1)
);
--> statement-breakpoint
ALTER TABLE "donations"."screens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "donations"."screens" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "donations"."gifts" DROP CONSTRAINT "gifts_source_check";--> statement-breakpoint
ALTER TABLE "donations"."gifts" ADD COLUMN "show_on_screen" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "donations"."screens" ADD CONSTRAINT "screens_campaign_fk" FOREIGN KEY ("org_id","campaign_id") REFERENCES "donations"."campaigns"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "screens_org_id_idx" ON "donations"."screens" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "screens_org_event_key" ON "donations"."screens" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "screens_org_campaign_idx" ON "donations"."screens" USING btree ("org_id","campaign_id");--> statement-breakpoint
-- hand-written: begin
-- New and widened CHECKs on an existing table: added NOT VALID (no long lock), then validated.
ALTER TABLE "donations"."gifts" ADD CONSTRAINT "gifts_show_on_screen_check" CHECK (not show_on_screen or display_as <> 'anonymous') NOT VALID;--> statement-breakpoint
ALTER TABLE "donations"."gifts" VALIDATE CONSTRAINT "gifts_show_on_screen_check";--> statement-breakpoint
-- hand-written: end
-- hand-written: begin
ALTER TABLE "donations"."gifts" ADD CONSTRAINT "gifts_source_check" CHECK (source in ('online', 'qr')) NOT VALID;--> statement-breakpoint
ALTER TABLE "donations"."gifts" VALIDATE CONSTRAINT "gifts_source_check";--> statement-breakpoint
-- hand-written: end
CREATE POLICY "screens_tenant_isolation" ON "donations"."screens" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- M4.8d: a screen belongs to one event and goes with it (donations is tier 5; events tier 2).
ALTER TABLE "donations"."screens" ADD CONSTRAINT "screens_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
-- The live giving screen's signed link (M4.8d): org + event from a verified HMAC token -> the
-- screen's current link version. Ids and the version only; only live orgs (like
-- engagement.display_target).
CREATE FUNCTION donations.screen_target(p_org uuid, p_event uuid)
RETURNS TABLE (version integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT s.version FROM donations.screens s
  JOIN tenancy.organizations o ON o.id = s.org_id AND o.status IN ('active', 'limited')
  WHERE s.org_id = p_org AND s.event_id = p_event
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION donations.screen_target(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION donations.screen_target(uuid, uuid) TO app_user;
-- hand-written: end
