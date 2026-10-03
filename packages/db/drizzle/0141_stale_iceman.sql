-- hand-written: begin
-- M6.12b: pgvector for matchmaking embeddings. `vector` is not a trusted extension, so the
-- migrator can't create it: the database bootstrap (local/CI, superuser) and the owner's
-- production runbook create it in the "extensions" schema first; here it is only asserted
-- (IF NOT EXISTS is a no-op when it exists, and fails loudly when the runbook step was missed).
CREATE SCHEMA IF NOT EXISTS "extensions";--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA "extensions";--> statement-breakpoint
-- hand-written: end
CREATE TABLE "ai"."brand_kits" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"voice" text DEFAULT '' NOT NULL,
	"tone" text DEFAULT 'friendly' NOT NULL,
	"keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	"avoid" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_by" text,
	CONSTRAINT "brand_kits_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "brand_kits_tone_check" CHECK (tone in ('friendly', 'formal', 'playful', 'urgent', 'inspiring')),
	CONSTRAINT "brand_kits_name_check" CHECK (char_length(name) between 1 and 60),
	CONSTRAINT "brand_kits_voice_check" CHECK (char_length(voice) <= 600),
	CONSTRAINT "brand_kits_terms_check" CHECK (cardinality(keywords) <= 12 and cardinality(avoid) <= 12)
);
--> statement-breakpoint
ALTER TABLE "ai"."brand_kits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai"."brand_kits" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "engagement"."network_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"embedding" "extensions"."vector"(512) NOT NULL, -- hand-written: schema-qualified type (drizzle quotes it as one name)
	"model" text NOT NULL,
	CONSTRAINT "network_embeddings_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "network_embeddings_model_check" CHECK (char_length(model) between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "engagement"."network_embeddings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "engagement"."network_embeddings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai"."credit_ledger" DROP CONSTRAINT "credit_ledger_draft_kind_check";--> statement-breakpoint
ALTER TABLE "engagement"."network_embeddings" ADD CONSTRAINT "network_embeddings_profile_fk" FOREIGN KEY ("org_id","profile_id") REFERENCES "engagement"."network_profiles"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brand_kits_org_id_idx" ON "ai"."brand_kits" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_kits_org_name_key" ON "ai"."brand_kits" USING btree ("org_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "brand_kits_org_default_key" ON "ai"."brand_kits" USING btree ("org_id") WHERE is_default;--> statement-breakpoint
CREATE INDEX "network_embeddings_org_id_idx" ON "engagement"."network_embeddings" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "network_embeddings_org_profile_key" ON "engagement"."network_embeddings" USING btree ("org_id","profile_id");--> statement-breakpoint
CREATE INDEX "network_embeddings_org_event_idx" ON "engagement"."network_embeddings" USING btree ("org_id","event_id");--> statement-breakpoint
-- hand-written: begin
-- Existing table: NOT VALID + VALIDATE keeps the lock short (expand/contract; every row already passes).
ALTER TABLE "ai"."credit_ledger" ADD CONSTRAINT "credit_ledger_draft_kind_check" CHECK (draft_kind is null or draft_kind in ('tagline', 'description', 'faq', 'campaign', 'page', 'agenda', 'audience', 'embedding')) NOT VALID;--> statement-breakpoint
ALTER TABLE "ai"."credit_ledger" VALIDATE CONSTRAINT "credit_ledger_draft_kind_check";--> statement-breakpoint
-- hand-written: end
CREATE POLICY "brand_kits_tenant_isolation" ON "ai"."brand_kits" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "network_embeddings_tenant_isolation" ON "engagement"."network_embeddings" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));