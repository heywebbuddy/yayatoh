CREATE TABLE "crm"."event_engagement" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"contact_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "event_engagement_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "event_engagement_score_check" CHECK (score >= 0)
);
--> statement-breakpoint
ALTER TABLE "crm"."event_engagement" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm"."event_engagement" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "engagement"."engagement_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"session_id" uuid,
	"kind" text NOT NULL,
	"source_ref" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "engagement_events_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "engagement_events_kind_check" CHECK (kind in ('check_in', 'poll_vote', 'question', 'feedback', 'enrollment')),
	CONSTRAINT "engagement_events_source_ref_check" CHECK (char_length(source_ref) between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "engagement"."engagement_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "engagement"."engagement_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "engagement"."score_weights" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"check_in" integer NOT NULL,
	"poll_vote" integer NOT NULL,
	"question" integer NOT NULL,
	"feedback" integer NOT NULL,
	"enrollment" integer NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "score_weights_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "score_weights_range_check" CHECK (check_in between 0 and 100 and poll_vote between 0 and 100 and question between 0 and 100 and feedback between 0 and 100 and enrollment between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "engagement"."score_weights" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "engagement"."score_weights" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "surveys"."sends" DROP CONSTRAINT "sends_source_check";--> statement-breakpoint
ALTER TABLE "crm"."event_engagement" ADD CONSTRAINT "event_engagement_contact_fk" FOREIGN KEY ("org_id","contact_id") REFERENCES "crm"."contacts"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_engagement_org_id_idx" ON "crm"."event_engagement" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_engagement_org_contact_event_key" ON "crm"."event_engagement" USING btree ("org_id","contact_id","event_id");--> statement-breakpoint
CREATE INDEX "event_engagement_org_event_score_idx" ON "crm"."event_engagement" USING btree ("org_id","event_id","score");--> statement-breakpoint
CREATE INDEX "engagement_events_org_id_idx" ON "engagement"."engagement_events" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "engagement_events_org_contact_kind_source_key" ON "engagement"."engagement_events" USING btree ("org_id","contact_id","kind","source_ref");--> statement-breakpoint
CREATE INDEX "engagement_events_org_event_contact_idx" ON "engagement"."engagement_events" USING btree ("org_id","event_id","contact_id");--> statement-breakpoint
CREATE INDEX "engagement_events_org_session_idx" ON "engagement"."engagement_events" USING btree ("org_id","session_id") WHERE session_id is not null;--> statement-breakpoint
CREATE INDEX "score_weights_org_id_idx" ON "engagement"."score_weights" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "score_weights_org_key" ON "engagement"."score_weights" USING btree ("org_id");--> statement-breakpoint
-- hand-written: begin
-- A widened CHECK on an existing table: added NOT VALID (no long lock), then validated.
ALTER TABLE "surveys"."sends" ADD CONSTRAINT "sends_source_check" CHECK (source in ('console', 'journey', 'prompt')) NOT VALID;--> statement-breakpoint
ALTER TABLE "surveys"."sends" VALIDATE CONSTRAINT "sends_source_check";--> statement-breakpoint
-- Cross-module FKs, down the tiers (engagement 5 → events 2, program 3, crm 1); new tables, so no
-- NOT VALID needed. A deleted session keeps its facts (they still count for the attendee).
ALTER TABLE "engagement"."engagement_events" ADD CONSTRAINT "engagement_events_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "engagement"."engagement_events" ADD CONSTRAINT "engagement_events_session_fk" FOREIGN KEY ("org_id","session_id") REFERENCES "program"."sessions"("org_id","id") ON DELETE SET NULL ("session_id");--> statement-breakpoint
ALTER TABLE "engagement"."engagement_events" ADD CONSTRAINT "engagement_events_contact_fk" FOREIGN KEY ("org_id","contact_id") REFERENCES "crm"."contacts"("org_id","id") ON DELETE cascade;--> statement-breakpoint
-- Like event_participation: crm's event reference, a composite FK to events.events.
ALTER TABLE "crm"."event_engagement" ADD CONSTRAINT "event_engagement_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
-- hand-written: end
CREATE POLICY "event_engagement_tenant_isolation" ON "crm"."event_engagement" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "engagement_events_tenant_isolation" ON "engagement"."engagement_events" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "score_weights_tenant_isolation" ON "engagement"."score_weights" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));