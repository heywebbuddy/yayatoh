CREATE TABLE "crm"."contact_scores" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"contact_id" uuid NOT NULL,
	"events" integer DEFAULT 0 NOT NULL,
	"events_registered" integer DEFAULT 0 NOT NULL,
	"events_attended" integer DEFAULT 0 NOT NULL,
	"past_registered" integer DEFAULT 0 NOT NULL,
	"no_shows" integer DEFAULT 0 NOT NULL,
	"sessions_attended" integer DEFAULT 0 NOT NULL,
	"campaigns_opened" integer DEFAULT 0 NOT NULL,
	"orders" integer DEFAULT 0 NOT NULL,
	"monetary_minor" bigint DEFAULT 0 NOT NULL,
	"monetary_currency" text NOT NULL,
	"first_seen_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"engagement_score" integer DEFAULT 0 NOT NULL,
	"no_show_bps" integer NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "contact_scores_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "contact_scores_counts_check" CHECK (events >= 0 and events_registered >= 0 and events_attended >= 0 and past_registered >= 0 and no_shows >= 0 and no_shows <= past_registered and sessions_attended >= 0 and campaigns_opened >= 0 and orders >= 0 and monetary_minor >= 0),
	CONSTRAINT "contact_scores_engagement_check" CHECK (engagement_score between 0 and 100),
	CONSTRAINT "contact_scores_no_show_check" CHECK (no_show_bps between 0 and 10000),
	CONSTRAINT "contact_scores_currency_check" CHECK (monetary_currency ~ '^[A-Z]{3}$'),
	CONSTRAINT "contact_scores_seen_check" CHECK (last_seen_at is null or last_seen_at >= first_seen_at)
);
--> statement-breakpoint
ALTER TABLE "crm"."contact_scores" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm"."contact_scores" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "crm"."contact_signals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"contact_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ref_id" uuid NOT NULL,
	"event_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "contact_signals_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "contact_signals_kind_check" CHECK (kind in ('session_attended', 'campaign_opened'))
);
--> statement-breakpoint
ALTER TABLE "crm"."contact_signals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm"."contact_signals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm"."contact_scores" ADD CONSTRAINT "contact_scores_contact_fk" FOREIGN KEY ("org_id","contact_id") REFERENCES "crm"."contacts"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."contact_signals" ADD CONSTRAINT "contact_signals_contact_fk" FOREIGN KEY ("org_id","contact_id") REFERENCES "crm"."contacts"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_scores_org_id_idx" ON "crm"."contact_scores" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_scores_org_contact_key" ON "crm"."contact_scores" USING btree ("org_id","contact_id");--> statement-breakpoint
CREATE INDEX "contact_scores_org_engagement_idx" ON "crm"."contact_scores" USING btree ("org_id","engagement_score");--> statement-breakpoint
CREATE INDEX "contact_scores_org_no_show_idx" ON "crm"."contact_scores" USING btree ("org_id","no_show_bps");--> statement-breakpoint
CREATE INDEX "contact_signals_org_id_idx" ON "crm"."contact_signals" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_signals_org_contact_kind_ref_key" ON "crm"."contact_signals" USING btree ("org_id","contact_id","kind","ref_id");--> statement-breakpoint
CREATE POLICY "contact_scores_tenant_isolation" ON "crm"."contact_scores" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "contact_signals_tenant_isolation" ON "crm"."contact_signals" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));