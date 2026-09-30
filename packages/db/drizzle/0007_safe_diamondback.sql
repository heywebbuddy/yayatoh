CREATE SCHEMA "ticketing";
--> statement-breakpoint
CREATE TABLE "billing"."fee_schedules" (
	"plan_key" text NOT NULL,
	"currency" text NOT NULL,
	"percent_bps" integer DEFAULT 0 NOT NULL,
	"fixed_minor" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "fee_schedules_plan_key_currency_pk" PRIMARY KEY("plan_key","currency"),
	CONSTRAINT "fee_schedules_bounds_check" CHECK (percent_bps between 0 and 5000 and fixed_minor >= 0)
);
--> statement-breakpoint
CREATE TABLE "billing"."org_fee_overrides" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"currency" text NOT NULL,
	"percent_bps" integer NOT NULL,
	"fixed_minor" bigint NOT NULL,
	"reason" text NOT NULL,
	CONSTRAINT "org_fee_overrides_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "org_fee_overrides_bounds_check" CHECK (percent_bps between 0 and 5000 and fixed_minor >= 0)
);
--> statement-breakpoint
ALTER TABLE "billing"."org_fee_overrides" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "billing"."org_fee_overrides" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ticketing"."ticket_types" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"fee_mode" text DEFAULT 'pass_on' NOT NULL,
	"quantity_total" integer NOT NULL,
	"quantity_sold" integer DEFAULT 0 NOT NULL,
	"quantity_held" integer DEFAULT 0 NOT NULL,
	"min_per_order" integer DEFAULT 1 NOT NULL,
	"max_per_order" integer DEFAULT 10 NOT NULL,
	"sales_start_at" timestamp with time zone,
	"sales_end_at" timestamp with time zone,
	"visibility" text DEFAULT 'public' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "ticket_types_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "ticket_types_inventory_check" CHECK (quantity_sold >= 0 and quantity_held >= 0 and quantity_sold + quantity_held <= quantity_total),
	CONSTRAINT "ticket_types_price_check" CHECK (price_minor >= 0),
	CONSTRAINT "ticket_types_per_order_check" CHECK (min_per_order >= 1 and max_per_order >= min_per_order),
	CONSTRAINT "ticket_types_window_check" CHECK (sales_end_at is null or sales_start_at is null or sales_end_at > sales_start_at),
	CONSTRAINT "ticket_types_visibility_check" CHECK (visibility in ('public', 'hidden')),
	CONSTRAINT "ticket_types_fee_mode_check" CHECK (fee_mode in ('pass_on', 'absorb')),
	CONSTRAINT "ticket_types_currency_check" CHECK (currency ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "ticketing"."ticket_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ticketing"."ticket_types" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "billing"."fee_schedules" ADD CONSTRAINT "fee_schedules_plan_key_plans_key_fk" FOREIGN KEY ("plan_key") REFERENCES "billing"."plans"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_fee_overrides_org_id_idx" ON "billing"."org_fee_overrides" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_fee_overrides_org_currency_key" ON "billing"."org_fee_overrides" USING btree ("org_id","currency");--> statement-breakpoint
CREATE INDEX "ticket_types_org_id_idx" ON "ticketing"."ticket_types" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "ticket_types_org_event_idx" ON "ticketing"."ticket_types" USING btree ("org_id","event_id","sort_order");--> statement-breakpoint
CREATE POLICY "org_fee_overrides_tenant_isolation" ON "billing"."org_fee_overrides" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "ticket_types_tenant_isolation" ON "ticketing"."ticket_types" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));