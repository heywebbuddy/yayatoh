CREATE SCHEMA "marketing";
--> statement-breakpoint
CREATE TABLE "marketing"."attribution_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"window_days" integer NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "attribution_settings_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "attribution_settings_window_check" CHECK (window_days between 1 and 90)
);
--> statement-breakpoint
ALTER TABLE "marketing"."attribution_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "marketing"."attribution_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "marketing"."attributions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"order_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"model" text NOT NULL,
	"first_click_id" uuid,
	"first_link_id" uuid,
	"first_at" timestamp with time zone NOT NULL,
	"last_click_id" uuid,
	"last_link_id" uuid,
	"last_at" timestamp with time zone NOT NULL,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_content" text,
	"utm_term" text,
	"first_utm_source" text,
	"first_utm_medium" text,
	"first_utm_campaign" text,
	"window_days" integer NOT NULL,
	CONSTRAINT "attributions_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "attributions_model_check" CHECK (model in ('click', 'utm')),
	CONSTRAINT "attributions_click_check" CHECK ((model = 'click') = (first_click_id is not null and last_click_id is not null and first_link_id is not null and last_link_id is not null)),
	CONSTRAINT "attributions_utm_check" CHECK (model <> 'utm' or utm_source is not null),
	CONSTRAINT "attributions_order_check" CHECK (first_at <= last_at),
	CONSTRAINT "attributions_window_check" CHECK (window_days between 1 and 90)
);
--> statement-breakpoint
ALTER TABLE "marketing"."attributions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "marketing"."attributions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "marketing"."link_clicks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"link_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"clicked_at" timestamp with time zone NOT NULL,
	"device_hash" text,
	"ip_hash" text,
	CONSTRAINT "link_clicks_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "link_clicks_device_hash_check" CHECK (device_hash is null or device_hash ~ '^[0-9a-f]{32}$'),
	CONSTRAINT "link_clicks_ip_hash_check" CHECK (ip_hash is null or ip_hash ~ '^[0-9a-f]{32}$')
);
--> statement-breakpoint
ALTER TABLE "marketing"."link_clicks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "marketing"."link_clicks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "marketing"."tracking_links" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text,
	"utm_source" text NOT NULL,
	"utm_medium" text NOT NULL,
	"utm_campaign" text NOT NULL,
	"utm_content" text,
	"utm_term" text,
	"destination_path" text,
	"campaign_id" uuid,
	"journey_step_id" uuid,
	"created_by" text NOT NULL,
	CONSTRAINT "tracking_links_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "tracking_links_code_check" CHECK (code ~ '^[a-z0-9]{8}$'),
	CONSTRAINT "tracking_links_label_check" CHECK (label is null or length(label) between 1 and 80),
	CONSTRAINT "tracking_links_source_check" CHECK ((length(utm_source) between 1 and 100)),
	CONSTRAINT "tracking_links_medium_check" CHECK ((length(utm_medium) between 1 and 100)),
	CONSTRAINT "tracking_links_campaign_check" CHECK ((length(utm_campaign) between 1 and 100)),
	CONSTRAINT "tracking_links_content_check" CHECK (utm_content is null or (length(utm_content) between 1 and 100)),
	CONSTRAINT "tracking_links_term_check" CHECK (utm_term is null or (length(utm_term) between 1 and 100)),
	CONSTRAINT "tracking_links_destination_check" CHECK (destination_path is null or (destination_path ~ '^/([^/\\]|$)' and length(destination_path) <= 300))
);
--> statement-breakpoint
ALTER TABLE "marketing"."tracking_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "marketing"."tracking_links" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "marketing"."attributions" ADD CONSTRAINT "attributions_first_click_fk" FOREIGN KEY ("org_id","first_click_id") REFERENCES "marketing"."link_clicks"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."attributions" ADD CONSTRAINT "attributions_last_click_fk" FOREIGN KEY ("org_id","last_click_id") REFERENCES "marketing"."link_clicks"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."attributions" ADD CONSTRAINT "attributions_first_link_fk" FOREIGN KEY ("org_id","first_link_id") REFERENCES "marketing"."tracking_links"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."attributions" ADD CONSTRAINT "attributions_last_link_fk" FOREIGN KEY ("org_id","last_link_id") REFERENCES "marketing"."tracking_links"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing"."link_clicks" ADD CONSTRAINT "link_clicks_link_fk" FOREIGN KEY ("org_id","link_id") REFERENCES "marketing"."tracking_links"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attribution_settings_org_id_idx" ON "marketing"."attribution_settings" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attribution_settings_org_key" ON "marketing"."attribution_settings" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "attributions_org_id_idx" ON "marketing"."attributions" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attributions_org_order_key" ON "marketing"."attributions" USING btree ("org_id","order_id");--> statement-breakpoint
CREATE INDEX "attributions_org_event_idx" ON "marketing"."attributions" USING btree ("org_id","event_id");--> statement-breakpoint
CREATE INDEX "attributions_org_first_link_idx" ON "marketing"."attributions" USING btree ("org_id","first_link_id") WHERE first_link_id is not null;--> statement-breakpoint
CREATE INDEX "attributions_org_last_link_idx" ON "marketing"."attributions" USING btree ("org_id","last_link_id") WHERE last_link_id is not null;--> statement-breakpoint
CREATE INDEX "link_clicks_org_id_idx" ON "marketing"."link_clicks" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "link_clicks_org_link_idx" ON "marketing"."link_clicks" USING btree ("org_id","link_id","clicked_at");--> statement-breakpoint
CREATE INDEX "link_clicks_org_event_idx" ON "marketing"."link_clicks" USING btree ("org_id","event_id","clicked_at");--> statement-breakpoint
CREATE INDEX "link_clicks_org_device_idx" ON "marketing"."link_clicks" USING btree ("org_id","device_hash","clicked_at") WHERE device_hash is not null;--> statement-breakpoint
CREATE INDEX "tracking_links_org_id_idx" ON "marketing"."tracking_links" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tracking_links_code_key" ON "marketing"."tracking_links" USING btree ("code");--> statement-breakpoint
CREATE INDEX "tracking_links_org_event_idx" ON "marketing"."tracking_links" USING btree ("org_id","event_id","created_at");--> statement-breakpoint
CREATE POLICY "attribution_settings_tenant_isolation" ON "marketing"."attribution_settings" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "attributions_tenant_isolation" ON "marketing"."attributions" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "link_clicks_tenant_isolation" ON "marketing"."link_clicks" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "tracking_links_tenant_isolation" ON "marketing"."tracking_links" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- M3.8a cross-module composite FKs, down the tiers (marketing 5 → orders 4, events 2); new tables, so no NOT VALID needed.
ALTER TABLE "marketing"."tracking_links" ADD CONSTRAINT "tracking_links_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "marketing"."link_clicks" ADD CONSTRAINT "link_clicks_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "marketing"."attributions" ADD CONSTRAINT "attributions_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "events"."events"("org_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "marketing"."attributions" ADD CONSTRAINT "attributions_order_fk" FOREIGN KEY ("org_id","order_id") REFERENCES "orders"."orders"("org_id","id") ON DELETE cascade;--> statement-breakpoint
-- /r/{code} → the link (cross-tenant, allowlisted columns): live orgs, events with a public page.
CREATE FUNCTION marketing.tracked_link_target(p_code text)
RETURNS TABLE (
  org_id uuid, link_id uuid, event_id uuid, slug text, destination_path text,
  utm_source text, utm_medium text, utm_campaign text, utm_content text, utm_term text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT l.org_id, l.id, l.event_id, e.slug, l.destination_path,
         l.utm_source, l.utm_medium, l.utm_campaign, l.utm_content, l.utm_term
  FROM marketing.tracking_links l
  JOIN events.events e ON e.org_id = l.org_id AND e.id = l.event_id
  JOIN tenancy.organizations o ON o.id = l.org_id AND o.status IN ('active', 'limited')
  WHERE l.code = lower(p_code)
    AND e.status IN ('published', 'postponed', 'cancelled', 'completed')
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION marketing.tracked_link_target(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION marketing.tracked_link_target(text) TO app_user;
-- hand-written: end
