CREATE TABLE "integrations"."account_maps" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"connection_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"accounts" jsonb NOT NULL,
	"starts_on" date NOT NULL,
	"created_by" uuid,
	CONSTRAINT "account_maps_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "account_maps_version_check" CHECK (version between 1 and 100000),
	CONSTRAINT "account_maps_accounts_check" CHECK (jsonb_typeof(accounts) = 'object')
);
--> statement-breakpoint
ALTER TABLE "integrations"."account_maps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "integrations"."account_maps" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "integrations"."accounting_journals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"connection_id" uuid NOT NULL,
	"day" date NOT NULL,
	"currency" text NOT NULL,
	"revision" integer NOT NULL,
	"kind" text NOT NULL,
	"reverses_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"summary" jsonb NOT NULL,
	"summary_key" text NOT NULL,
	"lines" jsonb NOT NULL,
	"debit_total_minor" bigint NOT NULL,
	"map_version" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"external_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"uncertain" boolean DEFAULT false NOT NULL,
	"last_error_code" text,
	"posted_at" timestamp with time zone,
	"run_id" uuid,
	CONSTRAINT "accounting_journals_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "accounting_journals_kind_check" CHECK (kind in ('journal', 'reversal')),
	CONSTRAINT "accounting_journals_status_check" CHECK (status in ('pending', 'posted', 'failed', 'superseded')),
	CONSTRAINT "accounting_journals_reverses_check" CHECK ((kind = 'reversal') = (reverses_id is not null)),
	CONSTRAINT "accounting_journals_currency_check" CHECK (currency ~ '^[A-Z]{3}$'),
	CONSTRAINT "accounting_journals_revision_check" CHECK (revision between 1 and 100000),
	CONSTRAINT "accounting_journals_lines_check" CHECK (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) between 2 and 20),
	CONSTRAINT "accounting_journals_summary_check" CHECK (jsonb_typeof(summary) = 'object'),
	CONSTRAINT "accounting_journals_debit_check" CHECK (debit_total_minor > 0),
	CONSTRAINT "accounting_journals_posted_check" CHECK ((status = 'posted') = (posted_at is not null and external_id is not null)),
	CONSTRAINT "accounting_journals_attempts_check" CHECK (attempts between 0 and 1000),
	CONSTRAINT "accounting_journals_error_code_check" CHECK (last_error_code is null or last_error_code ~ '^[a-z0-9_]{1,60}$'),
	CONSTRAINT "accounting_journals_external_check" CHECK (external_id is null or length(external_id) between 1 and 255)
);
--> statement-breakpoint
ALTER TABLE "integrations"."accounting_journals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "integrations"."accounting_journals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "integrations"."account_maps" ADD CONSTRAINT "account_maps_connection_fk" FOREIGN KEY ("org_id","connection_id") REFERENCES "integrations"."connections"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations"."accounting_journals" ADD CONSTRAINT "accounting_journals_connection_fk" FOREIGN KEY ("org_id","connection_id") REFERENCES "integrations"."connections"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations"."accounting_journals" ADD CONSTRAINT "accounting_journals_reverses_fk" FOREIGN KEY ("org_id","reverses_id") REFERENCES "integrations"."accounting_journals"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_maps_org_id_idx" ON "integrations"."account_maps" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_maps_org_connection_version_key" ON "integrations"."account_maps" USING btree ("org_id","connection_id","version");--> statement-breakpoint
CREATE INDEX "accounting_journals_org_id_idx" ON "integrations"."accounting_journals" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_journals_org_key" ON "integrations"."accounting_journals" USING btree ("org_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_journals_org_revision_key" ON "integrations"."accounting_journals" USING btree ("org_id","connection_id","day","currency","revision","kind");--> statement-breakpoint
CREATE INDEX "accounting_journals_org_connection_day_idx" ON "integrations"."accounting_journals" USING btree ("org_id","connection_id","day","currency");--> statement-breakpoint
CREATE INDEX "accounting_journals_org_connection_unsent_idx" ON "integrations"."accounting_journals" USING btree ("org_id","connection_id","created_at") WHERE status in ('pending', 'failed');--> statement-breakpoint
CREATE POLICY "account_maps_tenant_isolation" ON "integrations"."account_maps" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "accounting_journals_tenant_isolation" ON "integrations"."accounting_journals" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));