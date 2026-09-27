CREATE TABLE "payments"."disputes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"order_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"funds_flow" text NOT NULL,
	"provider" text NOT NULL,
	"provider_dispute_id" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"reason" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"evidence_due_by" timestamp with time zone,
	"evidence_submitted_at" timestamp with time zone,
	"evidence_submitted_by" text,
	"closed_at" timestamp with time zone,
	CONSTRAINT "disputes_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "disputes_status_check" CHECK (status in ('open', 'evidence_submitted', 'won', 'lost')),
	CONSTRAINT "disputes_amount_check" CHECK (amount_minor > 0)
);
--> statement-breakpoint
ALTER TABLE "payments"."disputes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payments"."disputes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "disputes_org_id_idx" ON "payments"."disputes" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "disputes_org_provider_key" ON "payments"."disputes" USING btree ("org_id","provider","provider_dispute_id");--> statement-breakpoint
CREATE INDEX "disputes_org_order_idx" ON "payments"."disputes" USING btree ("org_id","order_id");--> statement-breakpoint
CREATE POLICY "disputes_tenant_isolation" ON "payments"."disputes" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));