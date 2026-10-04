CREATE TABLE "registration"."calendar_feeds" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"registrant_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "calendar_feeds_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "calendar_feeds_version_check" CHECK (version between 1 and 1000000)
);
--> statement-breakpoint
ALTER TABLE "registration"."calendar_feeds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "registration"."calendar_feeds" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "registration"."session_favorites" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"registrant_id" uuid NOT NULL,
	CONSTRAINT "session_favorites_org_id_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "registration"."session_favorites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "registration"."session_favorites" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "calendar_feeds_org_id_idx" ON "registration"."calendar_feeds" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_feeds_org_registrant_key" ON "registration"."calendar_feeds" USING btree ("org_id","registrant_id");--> statement-breakpoint
CREATE INDEX "calendar_feeds_org_event_idx" ON "registration"."calendar_feeds" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "session_favorites_org_id_idx" ON "registration"."session_favorites" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_favorites_org_registrant_session_key" ON "registration"."session_favorites" USING btree ("org_id","registrant_id","session_id");--> statement-breakpoint
CREATE INDEX "session_favorites_org_event_idx" ON "registration"."session_favorites" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "session_favorites_org_session_idx" ON "registration"."session_favorites" USING btree ("org_id","session_id");--> statement-breakpoint
CREATE POLICY "calendar_feeds_tenant_isolation" ON "registration"."calendar_feeds" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "session_favorites_tenant_isolation" ON "registration"."session_favorites" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- M5.10a cross-module composite FKs, down the tiers (registration 5 → program 3, ticketing 3, events 2); new tables, so no NOT VALID needed.
ALTER TABLE "registration"."session_favorites" ADD CONSTRAINT "session_favorites_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "registration"."session_favorites" ADD CONSTRAINT "session_favorites_session_fk" FOREIGN KEY ("org_id","session_id") REFERENCES "program"."sessions"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "registration"."session_favorites" ADD CONSTRAINT "session_favorites_registrant_fk" FOREIGN KEY ("org_id","registrant_id") REFERENCES "ticketing"."tickets"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "registration"."calendar_feeds" ADD CONSTRAINT "calendar_feeds_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "registration"."calendar_feeds" ADD CONSTRAINT "calendar_feeds_registrant_fk" FOREIGN KEY ("org_id","registrant_id") REFERENCES "ticketing"."tickets"("org_id","id") ON DELETE cascade;--> statement-breakpoint
-- Signed calendar feeds (M5.10a): org + registrant from a verified HMAC token → the registrant's
-- event and current feed version (1 when never replaced). Ids and the version only; an active
-- ticket only; only live orgs (like engagement.display_target).
CREATE FUNCTION registration.calendar_feed_target(p_org uuid, p_registrant uuid)
RETURNS TABLE (event_id uuid, feed_version integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT t.event_id, COALESCE(f.version, 1) FROM ticketing.tickets t
  JOIN tenancy.organizations o ON o.id = t.org_id AND o.status IN ('active', 'limited')
  LEFT JOIN registration.calendar_feeds f ON f.org_id = t.org_id AND f.registrant_id = t.id
  WHERE t.org_id = p_org AND t.id = p_registrant AND t.status = 'active'
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION registration.calendar_feed_target(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION registration.calendar_feed_target(uuid, uuid) TO app_user;
-- hand-written: end
