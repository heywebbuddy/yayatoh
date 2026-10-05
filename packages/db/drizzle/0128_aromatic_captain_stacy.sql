CREATE TABLE "donations"."paddle_calls" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"level_id" uuid,
	"level_name" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "paddle_calls_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "paddle_calls_status_check" CHECK (status in ('open', 'closed', 'withdrawn')),
	CONSTRAINT "paddle_calls_amount_check" CHECK (amount_minor > 0),
	CONSTRAINT "paddle_calls_currency_check" CHECK (currency ~ '^[A-Z]{3}$'),
	CONSTRAINT "paddle_calls_level_name_length" CHECK (length(level_name) between 1 and 80),
	CONSTRAINT "paddle_calls_closed_check" CHECK ((status = 'closed') = (closed_at is not null))
);
--> statement-breakpoint
ALTER TABLE "donations"."paddle_calls" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "donations"."paddle_calls" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "donations"."paddle_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"call_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"paddle_id" uuid,
	"paddle_number" integer NOT NULL,
	"status" text NOT NULL,
	"duplicate_of" uuid,
	"spotter_user_id" text,
	"recorded_at" timestamp with time zone NOT NULL,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "paddle_entries_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "paddle_entries_status_check" CHECK (status in ('recorded', 'duplicate', 'confirmed', 'voided')),
	CONSTRAINT "paddle_entries_number_check" CHECK (paddle_number between 1 and 99999),
	CONSTRAINT "paddle_entries_spotter_length" CHECK (spotter_user_id is null or length(spotter_user_id) <= 64)
);
--> statement-breakpoint
ALTER TABLE "donations"."paddle_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "donations"."paddle_entries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "donations"."paddles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"guest_id" uuid,
	"party_id" uuid,
	CONSTRAINT "paddles_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "paddles_number_check" CHECK (number between 1 and 99999),
	CONSTRAINT "paddles_holder_check" CHECK ((guest_id is null) <> (party_id is null))
);
--> statement-breakpoint
ALTER TABLE "donations"."paddles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "donations"."paddles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "donations"."pledges" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"call_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"paddle_number" integer NOT NULL,
	"guest_id" uuid,
	"party_id" uuid,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"source" text DEFAULT 'paddle' NOT NULL,
	"confirmed_at" timestamp with time zone NOT NULL,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "pledges_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "pledges_status_check" CHECK (status in ('confirmed', 'cancelled')),
	CONSTRAINT "pledges_source_check" CHECK (source = 'paddle'),
	CONSTRAINT "pledges_amount_check" CHECK (amount_minor > 0),
	CONSTRAINT "pledges_currency_check" CHECK (currency ~ '^[A-Z]{3}$'),
	CONSTRAINT "pledges_cancelled_check" CHECK ((status = 'cancelled') = (cancelled_at is not null))
);
--> statement-breakpoint
ALTER TABLE "donations"."pledges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "donations"."pledges" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "donations"."paddle_calls" ADD CONSTRAINT "paddle_calls_campaign_fk" FOREIGN KEY ("org_id","campaign_id") REFERENCES "donations"."campaigns"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations"."paddle_entries" ADD CONSTRAINT "paddle_entries_call_fk" FOREIGN KEY ("org_id","call_id") REFERENCES "donations"."paddle_calls"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations"."pledges" ADD CONSTRAINT "pledges_campaign_fk" FOREIGN KEY ("org_id","campaign_id") REFERENCES "donations"."campaigns"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations"."pledges" ADD CONSTRAINT "pledges_call_fk" FOREIGN KEY ("org_id","call_id") REFERENCES "donations"."paddle_calls"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations"."pledges" ADD CONSTRAINT "pledges_entry_fk" FOREIGN KEY ("org_id","entry_id") REFERENCES "donations"."paddle_entries"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "paddle_calls_org_id_idx" ON "donations"."paddle_calls" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "paddle_calls_org_event_opened_idx" ON "donations"."paddle_calls" USING btree ("org_id","event_id","opened_at");--> statement-breakpoint
CREATE UNIQUE INDEX "paddle_calls_org_event_open_key" ON "donations"."paddle_calls" USING btree ("org_id","event_id") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "paddle_entries_org_id_idx" ON "donations"."paddle_entries" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "paddle_entries_org_client_key" ON "donations"."paddle_entries" USING btree ("org_id","client_id");--> statement-breakpoint
CREATE INDEX "paddle_entries_org_call_paddle_idx" ON "donations"."paddle_entries" USING btree ("org_id","call_id","paddle_number");--> statement-breakpoint
CREATE INDEX "paddle_entries_org_event_created_idx" ON "donations"."paddle_entries" USING btree ("org_id","event_id","created_at");--> statement-breakpoint
CREATE INDEX "paddles_org_id_idx" ON "donations"."paddles" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "paddles_org_event_number_key" ON "donations"."paddles" USING btree ("org_id","event_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "paddles_org_guest_key" ON "donations"."paddles" USING btree ("org_id","guest_id") WHERE guest_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "paddles_org_party_key" ON "donations"."paddles" USING btree ("org_id","party_id") WHERE party_id is not null;--> statement-breakpoint
CREATE INDEX "pledges_org_id_idx" ON "donations"."pledges" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pledges_org_entry_key" ON "donations"."pledges" USING btree ("org_id","entry_id");--> statement-breakpoint
CREATE INDEX "pledges_org_event_status_idx" ON "donations"."pledges" USING btree ("org_id","event_id","status");--> statement-breakpoint
CREATE INDEX "pledges_org_campaign_idx" ON "donations"."pledges" USING btree ("org_id","campaign_id");--> statement-breakpoint
CREATE POLICY "paddle_calls_tenant_isolation" ON "donations"."paddle_calls" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "paddle_entries_tenant_isolation" ON "donations"."paddle_entries" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "paddles_tenant_isolation" ON "donations"."paddles" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "pledges_tenant_isolation" ON "donations"."pledges" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- M4.8c cross-module composite FKs (donations is tier 5; events tier 2, guests tier 3).
-- Paddles, calls and entries belong to one event and go with it. A paddle goes with its guest or
-- party. A pledge keeps its event (a money promise, like a gift: an event with pledges cannot be
-- deleted) and keeps its holder's number when the guest or party goes (only the id clears).
ALTER TABLE "donations"."paddles" ADD CONSTRAINT "paddles_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "donations"."paddles" ADD CONSTRAINT "paddles_guest_fk" FOREIGN KEY ("org_id","guest_id") REFERENCES "guests"."guests"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "donations"."paddles" ADD CONSTRAINT "paddles_party_fk" FOREIGN KEY ("org_id","party_id") REFERENCES "guests"."parties"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "donations"."paddle_calls" ADD CONSTRAINT "paddle_calls_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "donations"."paddle_calls" ADD CONSTRAINT "paddle_calls_level_fk" FOREIGN KEY ("org_id","level_id") REFERENCES "donations"."levels"("org_id","id") ON DELETE SET NULL ("level_id");--> statement-breakpoint
ALTER TABLE "donations"."paddle_entries" ADD CONSTRAINT "paddle_entries_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "donations"."paddle_entries" ADD CONSTRAINT "paddle_entries_paddle_fk" FOREIGN KEY ("org_id","paddle_id") REFERENCES "donations"."paddles"("org_id","id") ON DELETE SET NULL ("paddle_id");--> statement-breakpoint
ALTER TABLE "donations"."pledges" ADD CONSTRAINT "pledges_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id");--> statement-breakpoint
ALTER TABLE "donations"."pledges" ADD CONSTRAINT "pledges_guest_fk" FOREIGN KEY ("org_id","guest_id") REFERENCES "guests"."guests"("org_id","id") ON DELETE SET NULL ("guest_id");--> statement-breakpoint
ALTER TABLE "donations"."pledges" ADD CONSTRAINT "pledges_party_fk" FOREIGN KEY ("org_id","party_id") REFERENCES "guests"."parties"("org_id","id") ON DELETE SET NULL ("party_id");
-- hand-written: end
