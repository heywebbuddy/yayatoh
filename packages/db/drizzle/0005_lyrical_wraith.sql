CREATE SCHEMA "events";
--> statement-breakpoint
CREATE TABLE "events"."event_role_assignments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "event_role_assignments_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "event_role_assignments_role_check" CHECK (role in ('event_manager', 'door_staff', 'seating_manager', 'session_scanner', 'exhibitor_admin', 'exhibitor_staff', 'speaker', 'sponsor_contact', 'kiosk_operator', 'venue_viewer'))
);
--> statement-breakpoint
ALTER TABLE "events"."event_role_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "events"."event_role_assignments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "events"."events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"tagline" text,
	"profile" text DEFAULT 'other' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"timezone" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"venue_name" text,
	"city" text,
	"country" text,
	"currency" text DEFAULT 'USD' NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "events_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "events_status_check" CHECK (status in ('draft', 'published', 'postponed', 'cancelled', 'completed', 'archived')),
	CONSTRAINT "events_visibility_check" CHECK (visibility in ('public', 'unlisted', 'private')),
	CONSTRAINT "events_profile_check" CHECK (profile in ('wedding', 'gala', 'concert', 'conference', 'community', 'agency', 'other')),
	CONSTRAINT "events_time_order_check" CHECK (ends_at > starts_at),
	CONSTRAINT "events_slug_format_check" CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$'),
	CONSTRAINT "events_currency_check" CHECK (currency ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "events"."events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "events"."events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "events"."event_role_assignments" ADD CONSTRAINT "event_role_assignments_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_role_assignments_org_id_idx" ON "events"."event_role_assignments" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_role_assignments_org_event_user_role_key" ON "events"."event_role_assignments" USING btree ("org_id","event_id","user_id","role");--> statement-breakpoint
CREATE INDEX "event_role_assignments_org_user_idx" ON "events"."event_role_assignments" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "events_org_id_idx" ON "events"."events" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "events_slug_key" ON "events"."events" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "events_org_id_starts_at_idx" ON "events"."events" USING btree ("org_id","starts_at");--> statement-breakpoint
CREATE POLICY "event_role_assignments_tenant_isolation" ON "events"."event_role_assignments" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "events_tenant_isolation" ON "events"."events" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));