CREATE TABLE "auth"."legacy_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"instance" text NOT NULL,
	"kind" text NOT NULL,
	"legacy_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"name" text,
	"abilities" jsonb,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legacy_tokens_instance_check" CHECK (instance in ('yay', 'abc')),
	CONSTRAINT "legacy_tokens_kind_check" CHECK (kind in ('personal_access', 'magic_login', 'password_reset'))
);
--> statement-breakpoint
CREATE TABLE "platform"."metric_timeseries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metric" text NOT NULL,
	"bucket" date NOT NULL,
	"currency" text DEFAULT '' NOT NULL,
	"value" bigint NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "metric_timeseries_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "metric_timeseries_source_check" CHECK (source in ('legacy', 'live')),
	CONSTRAINT "metric_timeseries_bucket_check" CHECK (extract(day from bucket) = 1),
	CONSTRAINT "metric_timeseries_currency_check" CHECK (currency = '' or currency ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "platform"."metric_timeseries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform"."metric_timeseries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "crm"."contact_stats" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"contact_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"orders" integer DEFAULT 0 NOT NULL,
	"tickets" integer DEFAULT 0 NOT NULL,
	"events" integer DEFAULT 0 NOT NULL,
	"events_attended" integer DEFAULT 0 NOT NULL,
	"spend_minor" bigint DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "contact_stats_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "contact_stats_counts_check" CHECK (orders >= 0 and tickets >= 0 and events >= 0 and events_attended >= 0),
	CONSTRAINT "contact_stats_currency_check" CHECK (currency ~ '^[A-Z]{3}$'),
	CONSTRAINT "contact_stats_seen_check" CHECK (last_seen_at >= first_seen_at),
	CONSTRAINT "contact_stats_source_check" CHECK (source in ('legacy', 'live'))
);
--> statement-breakpoint
ALTER TABLE "crm"."contact_stats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm"."contact_stats" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "crm"."event_participation" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"contact_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"ticket_type_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"tickets" integer DEFAULT 0 NOT NULL,
	"has_seat" boolean DEFAULT false NOT NULL,
	"checked_in" boolean DEFAULT false NOT NULL,
	"registered_at" timestamp with time zone NOT NULL,
	"spend_minor" bigint DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "event_participation_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "event_participation_counts_check" CHECK (tickets >= 0 and spend_minor >= 0),
	CONSTRAINT "event_participation_currency_check" CHECK (currency ~ '^[A-Z]{3}$'),
	CONSTRAINT "event_participation_source_check" CHECK (source in ('legacy', 'live'))
);
--> statement-breakpoint
ALTER TABLE "crm"."event_participation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm"."event_participation" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform"."domain_events" ADD COLUMN "replayed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "auth"."legacy_tokens" ADD CONSTRAINT "legacy_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."contact_stats" ADD CONSTRAINT "contact_stats_contact_fk" FOREIGN KEY ("org_id","contact_id") REFERENCES "crm"."contacts"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."event_participation" ADD CONSTRAINT "event_participation_contact_fk" FOREIGN KEY ("org_id","contact_id") REFERENCES "crm"."contacts"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_tokens_instance_kind_legacy_key" ON "auth"."legacy_tokens" USING btree ("instance","kind","legacy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_tokens_kind_hash_key" ON "auth"."legacy_tokens" USING btree ("kind","token_hash") WHERE kind <> 'password_reset';--> statement-breakpoint
CREATE INDEX "legacy_tokens_user_idx" ON "auth"."legacy_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "metric_timeseries_org_id_idx" ON "platform"."metric_timeseries" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "metric_timeseries_org_metric_bucket_key" ON "platform"."metric_timeseries" USING btree ("org_id","metric","bucket","currency","source");--> statement-breakpoint
CREATE INDEX "contact_stats_org_id_idx" ON "crm"."contact_stats" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_stats_org_contact_currency_key" ON "crm"."contact_stats" USING btree ("org_id","contact_id","currency");--> statement-breakpoint
CREATE INDEX "event_participation_org_id_idx" ON "crm"."event_participation" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_participation_org_contact_event_key" ON "crm"."event_participation" USING btree ("org_id","contact_id","event_id");--> statement-breakpoint
CREATE INDEX "event_participation_org_event_idx" ON "crm"."event_participation" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE POLICY "metric_timeseries_tenant_isolation" ON "platform"."metric_timeseries" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "contact_stats_tenant_isolation" ON "crm"."contact_stats" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "event_participation_tenant_isolation" ON "crm"."event_participation" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin (M2.2c: cross-module foreign key, replayed events through the relay)
-- crm (tier 1) → events (tier 2) would be an upward import; the composite FK lives here instead.
ALTER TABLE "crm"."event_participation" ADD CONSTRAINT "event_participation_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
-- The relay hands `replayed` to the worker so backfilled history is never enqueued for mailers
-- (ADR 0008). The return type changes, so the function is replaced (same grants as 0001).
DROP FUNCTION platform.relay_pending(integer);--> statement-breakpoint
CREATE FUNCTION platform.relay_pending(batch_size integer)
RETURNS TABLE (id uuid, org_id uuid, type text, version integer, aggregate_type text, aggregate_id text, payload jsonb, log_seq bigint, replayed boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT e.id, e.org_id, e.type, e.version, e.aggregate_type, e.aggregate_id, e.payload, e.log_seq, e.replayed
  FROM platform.domain_events e
  WHERE e.log_seq IS NOT NULL AND e.published_at IS NULL
  ORDER BY e.log_seq
  LIMIT batch_size
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.relay_pending(integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform.relay_pending(integer) TO platform_reader;
-- hand-written: end
