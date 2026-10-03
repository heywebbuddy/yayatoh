CREATE SCHEMA "donations";
--> statement-breakpoint
CREATE TABLE "donations"."campaigns" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"goal_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"min_gift_minor" bigint NOT NULL,
	"max_gift_minor" bigint NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "campaigns_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "campaigns_name_length" CHECK (length(name) between 1 and 120),
	CONSTRAINT "campaigns_description_length" CHECK (description is null or length(description) <= 2000),
	CONSTRAINT "campaigns_goal_check" CHECK (goal_minor > 0),
	CONSTRAINT "campaigns_currency_check" CHECK (currency ~ '^[A-Z]{3}$'),
	CONSTRAINT "campaigns_limits_check" CHECK (min_gift_minor > 0 and max_gift_minor >= min_gift_minor),
	CONSTRAINT "campaigns_status_check" CHECK (status in ('open', 'closed'))
);
--> statement-breakpoint
ALTER TABLE "donations"."campaigns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "donations"."campaigns" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "donations"."gifts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"level_id" uuid,
	"order_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"source" text DEFAULT 'online' NOT NULL,
	"amount_minor" bigint NOT NULL,
	"fee_cover_minor" bigint DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"donor_name" text NOT NULL,
	"donor_email" text NOT NULL,
	"display_as" text NOT NULL,
	"employer" text,
	"tribute_kind" text,
	"tribute_name" text,
	"tribute_recipient" text,
	"tribute_note" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "gifts_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "gifts_status_check" CHECK (status in ('pending', 'paid', 'failed', 'expired')),
	CONSTRAINT "gifts_source_check" CHECK (source in ('online')),
	CONSTRAINT "gifts_display_as_check" CHECK (display_as in ('full_name', 'first_name', 'anonymous')),
	CONSTRAINT "gifts_amount_check" CHECK (amount_minor > 0 and fee_cover_minor >= 0),
	CONSTRAINT "gifts_currency_check" CHECK (currency ~ '^[A-Z]{3}$'),
	CONSTRAINT "gifts_paid_check" CHECK ((status = 'paid') = (paid_at is not null)),
	CONSTRAINT "gifts_donor_name_length" CHECK (length(donor_name) between 1 and 120),
	CONSTRAINT "gifts_donor_email_check" CHECK (donor_email = lower(donor_email) and length(donor_email) <= 254),
	CONSTRAINT "gifts_employer_length" CHECK (employer is null or length(employer) between 1 and 120),
	CONSTRAINT "gifts_tribute_check" CHECK ((tribute_kind is null and tribute_name is null and tribute_recipient is null and tribute_note is null) or (tribute_kind is not null and tribute_name is not null)),
	CONSTRAINT "gifts_tribute_kind_check" CHECK (tribute_kind is null or tribute_kind in ('honor', 'memory')),
	CONSTRAINT "gifts_tribute_name_length" CHECK (tribute_name is null or length(tribute_name) between 1 and 120),
	CONSTRAINT "gifts_tribute_recipient_length" CHECK (tribute_recipient is null or length(tribute_recipient) between 1 and 120),
	CONSTRAINT "gifts_tribute_note_length" CHECK (tribute_note is null or length(tribute_note) between 1 and 500)
);
--> statement-breakpoint
ALTER TABLE "donations"."gifts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "donations"."gifts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "donations"."levels" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"name" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"description" text,
	CONSTRAINT "levels_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "levels_name_length" CHECK (length(name) between 1 and 80),
	CONSTRAINT "levels_description_length" CHECK (description is null or length(description) <= 200),
	CONSTRAINT "levels_amount_check" CHECK (amount_minor > 0)
);
--> statement-breakpoint
ALTER TABLE "donations"."levels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "donations"."levels" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "orders"."donation_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"order_id" uuid NOT NULL,
	"gift_id" uuid NOT NULL,
	"name" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"fee_cover_minor" bigint DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	CONSTRAINT "donation_items_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "donation_items_amount_check" CHECK (amount_minor > 0 and fee_cover_minor >= 0),
	CONSTRAINT "donation_items_currency_check" CHECK (currency ~ '^[A-Z]{3}$'),
	CONSTRAINT "donation_items_name_length" CHECK (length(name) between 1 and 120)
);
--> statement-breakpoint
ALTER TABLE "orders"."donation_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders"."donation_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "donations"."gifts" ADD CONSTRAINT "gifts_campaign_fk" FOREIGN KEY ("org_id","campaign_id") REFERENCES "donations"."campaigns"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations"."levels" ADD CONSTRAINT "levels_campaign_fk" FOREIGN KEY ("org_id","campaign_id") REFERENCES "donations"."campaigns"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."donation_items" ADD CONSTRAINT "donation_items_order_fk" FOREIGN KEY ("org_id","order_id") REFERENCES "orders"."orders"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaigns_org_id_idx" ON "donations"."campaigns" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "campaigns_org_event_idx" ON "donations"."campaigns" USING btree ("org_id","event_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "campaigns_org_event_name_key" ON "donations"."campaigns" USING btree ("org_id","event_id","name");--> statement-breakpoint
CREATE INDEX "gifts_org_id_idx" ON "donations"."gifts" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "gifts_org_campaign_status_idx" ON "donations"."gifts" USING btree ("org_id","campaign_id","status");--> statement-breakpoint
CREATE INDEX "gifts_org_event_created_idx" ON "donations"."gifts" USING btree ("org_id","event_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "gifts_org_order_key" ON "donations"."gifts" USING btree ("org_id","order_id");--> statement-breakpoint
CREATE INDEX "levels_org_id_idx" ON "donations"."levels" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "levels_org_campaign_idx" ON "donations"."levels" USING btree ("org_id","campaign_id","amount_minor");--> statement-breakpoint
CREATE UNIQUE INDEX "levels_org_campaign_amount_key" ON "donations"."levels" USING btree ("org_id","campaign_id","amount_minor");--> statement-breakpoint
CREATE INDEX "donation_items_org_id_idx" ON "orders"."donation_items" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "donation_items_org_order_key" ON "orders"."donation_items" USING btree ("org_id","order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "donation_items_org_gift_key" ON "orders"."donation_items" USING btree ("org_id","gift_id");--> statement-breakpoint
CREATE POLICY "campaigns_tenant_isolation" ON "donations"."campaigns" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "gifts_tenant_isolation" ON "donations"."gifts" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "levels_tenant_isolation" ON "donations"."levels" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "donation_items_tenant_isolation" ON "orders"."donation_items" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- M4.8a cross-module composite FKs (donations is tier 5; events tier 2, orders tier 4).
-- A campaign belongs to one event and goes with it; a gift keeps its event and its order (money
-- records: an event or order with gifts cannot be deleted).
ALTER TABLE "donations"."campaigns" ADD CONSTRAINT "campaigns_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "donations"."gifts" ADD CONSTRAINT "gifts_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id");--> statement-breakpoint
ALTER TABLE "donations"."gifts" ADD CONSTRAINT "gifts_order_fk" FOREIGN KEY ("org_id","order_id") REFERENCES "orders"."orders"("org_id","id");--> statement-breakpoint
-- Removing a level keeps its gifts: only level_id clears (org_id stays).
ALTER TABLE "donations"."gifts" ADD CONSTRAINT "gifts_level_fk" FOREIGN KEY ("org_id","level_id") REFERENCES "donations"."levels"("org_id","id") ON DELETE SET NULL ("level_id");
-- hand-written: end
