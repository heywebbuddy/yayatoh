CREATE TABLE "ai"."insights" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	"based_on" integer NOT NULL,
	"total" integer NOT NULL,
	"model" text NOT NULL,
	CONSTRAINT "insights_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "insights_subject_check" CHECK (subject in ('reviews', 'survey'))
);
--> statement-breakpoint
ALTER TABLE "ai"."insights" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai"."insights" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ai"."usage" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purpose" text NOT NULL,
	"event_id" uuid,
	"debit_id" uuid,
	"model" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"cache_read_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cost_micros" integer NOT NULL,
	"latency_ms" integer NOT NULL,
	"outcome" text NOT NULL,
	CONSTRAINT "usage_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "usage_purpose_check" CHECK (purpose in ('tagline', 'description', 'faq', 'campaign', 'page', 'agenda', 'audience', 'event_setup', 'insights', 'support_assist', 'help_answer', 'translate', 'embedding', 'assistant')),
	CONSTRAINT "usage_outcome_check" CHECK (outcome in ('ok', 'refused', 'unusable', 'unavailable'))
);
--> statement-breakpoint
ALTER TABLE "ai"."usage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai"."usage" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai"."credit_ledger" DROP CONSTRAINT "credit_ledger_draft_kind_check";--> statement-breakpoint
CREATE INDEX "insights_org_id_idx" ON "ai"."insights" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "insights_org_subject_key" ON "ai"."insights" USING btree ("org_id","subject","subject_id");--> statement-breakpoint
CREATE INDEX "usage_org_id_idx" ON "ai"."usage" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "usage_org_created_idx" ON "ai"."usage" USING btree ("org_id","created_at");--> statement-breakpoint
ALTER TABLE "ai"."credit_ledger" ADD CONSTRAINT "credit_ledger_draft_kind_check" CHECK (draft_kind is null or draft_kind in ('tagline', 'description', 'faq', 'campaign', 'page', 'agenda', 'audience', 'event_setup', 'insights', 'support_assist', 'help_answer', 'translate', 'embedding', 'assistant'));--> statement-breakpoint
CREATE POLICY "insights_tenant_isolation" ON "ai"."insights" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "usage_tenant_isolation" ON "ai"."usage" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin (usage is append-only for the app; a summary goes with its event)
REVOKE UPDATE, DELETE, TRUNCATE ON "ai"."usage" FROM app_user;--> statement-breakpoint
ALTER TABLE "ai"."insights" ADD CONSTRAINT "insights_event_fk" FOREIGN KEY ("org_id", "event_id") REFERENCES "events"."events" ("org_id", "id") ON DELETE CASCADE;
-- hand-written: end
