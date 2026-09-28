CREATE TABLE "platform"."status_fake_incidents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"title" text NOT NULL,
	"impact" text NOT NULL,
	"status" text NOT NULL,
	"components" text[] DEFAULT '{}'::text[] NOT NULL,
	"updates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "status_fake_incidents_title_check" CHECK (char_length(title) between 1 and 160),
	CONSTRAINT "status_fake_incidents_impact_check" CHECK (impact in ('minor', 'major', 'critical', 'maintenance')),
	CONSTRAINT "status_fake_incidents_status_check" CHECK (status in ('investigating', 'identified', 'monitoring', 'resolved', 'scheduled', 'in_progress', 'completed')),
	CONSTRAINT "status_fake_incidents_updates_check" CHECK (jsonb_typeof(updates) = 'array'),
	CONSTRAINT "status_fake_incidents_resolved_check" CHECK ((status in ('resolved', 'completed')) = (resolved_at is not null))
);
--> statement-breakpoint
CREATE TABLE "cms"."contact_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"topic" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"company" text,
	"message" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"handled_at" timestamp with time zone,
	CONSTRAINT "contact_requests_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "contact_requests_topic_check" CHECK (topic in ('sales', 'support', 'partnership', 'other')),
	CONSTRAINT "contact_requests_status_check" CHECK (status in ('new', 'handled')),
	CONSTRAINT "contact_requests_name_check" CHECK (char_length(name) between 1 and 120),
	CONSTRAINT "contact_requests_email_check" CHECK (char_length(email) between 3 and 254),
	CONSTRAINT "contact_requests_company_check" CHECK (company is null or char_length(company) <= 160),
	CONSTRAINT "contact_requests_message_check" CHECK (char_length(message) between 1 and 4000),
	CONSTRAINT "contact_requests_locale_check" CHECK (locale ~ '^[a-z]{2}(-[A-Z]{2})?$')
);
--> statement-breakpoint
ALTER TABLE "cms"."contact_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cms"."contact_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cms"."help_articles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"category_id" uuid NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"body" text DEFAULT '' NOT NULL,
	"keywords" text,
	"position" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"seo_title" text,
	"seo_description" text,
	CONSTRAINT "help_articles_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "help_articles_locale_check" CHECK (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
	CONSTRAINT "help_articles_slug_check" CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$'),
	CONSTRAINT "help_articles_status_check" CHECK (status in ('draft', 'published', 'archived')),
	CONSTRAINT "help_articles_title_check" CHECK (char_length(title) between 1 and 160),
	CONSTRAINT "help_articles_summary_check" CHECK (summary is null or char_length(summary) <= 300),
	CONSTRAINT "help_articles_body_check" CHECK (char_length(body) <= 20000),
	CONSTRAINT "help_articles_keywords_check" CHECK (keywords is null or char_length(keywords) <= 300),
	CONSTRAINT "help_articles_position_check" CHECK (position between 0 and 10000),
	CONSTRAINT "help_articles_seo_title_check" CHECK (seo_title is null or char_length(seo_title) <= 70),
	CONSTRAINT "help_articles_seo_description_check" CHECK (seo_description is null or char_length(seo_description) <= 160),
	CONSTRAINT "help_articles_published_at_check" CHECK (status <> 'published' or published_at is not null)
);
--> statement-breakpoint
ALTER TABLE "cms"."help_articles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cms"."help_articles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cms"."help_categories" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"audience" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"translations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "help_categories_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "help_categories_audience_check" CHECK (audience in ('organizers', 'buyers')),
	CONSTRAINT "help_categories_slug_check" CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$'),
	CONSTRAINT "help_categories_title_check" CHECK (char_length(title) between 1 and 80),
	CONSTRAINT "help_categories_description_check" CHECK (description is null or char_length(description) <= 300),
	CONSTRAINT "help_categories_translations_check" CHECK (jsonb_typeof(translations) = 'object'),
	CONSTRAINT "help_categories_position_check" CHECK (position between 0 and 10000)
);
--> statement-breakpoint
ALTER TABLE "cms"."help_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cms"."help_categories" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cms"."help_feedback" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"article_id" uuid NOT NULL,
	"helpful" boolean NOT NULL,
	"reason" text,
	"voter_key" text NOT NULL,
	CONSTRAINT "help_feedback_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "help_feedback_reason_check" CHECK (reason is null or (not helpful and reason in ('unclear', 'incomplete', 'outdated', 'other')))
);
--> statement-breakpoint
ALTER TABLE "cms"."help_feedback" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cms"."help_feedback" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cms"."site_sections" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"placement" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"slug" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"eyebrow" text,
	"heading" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"cta_label" text,
	"cta_href" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "site_sections_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "site_sections_placement_check" CHECK (placement in ('home', 'features', 'contact')),
	CONSTRAINT "site_sections_locale_check" CHECK (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
	CONSTRAINT "site_sections_slug_check" CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$'),
	CONSTRAINT "site_sections_status_check" CHECK (status in ('draft', 'published', 'archived')),
	CONSTRAINT "site_sections_eyebrow_check" CHECK (eyebrow is null or char_length(eyebrow) <= 60),
	CONSTRAINT "site_sections_heading_check" CHECK (char_length(heading) between 1 and 120),
	CONSTRAINT "site_sections_body_check" CHECK (char_length(body) <= 4000),
	CONSTRAINT "site_sections_cta_label_check" CHECK (cta_label is null or char_length(cta_label) <= 40),
	CONSTRAINT "site_sections_cta_check" CHECK ((cta_label is null) = (cta_href is null) and (cta_href is null or (char_length(cta_href) <= 300 and cta_href ~ '^(/[^/]|/$|https://)'))),
	CONSTRAINT "site_sections_position_check" CHECK (position between 0 and 10000),
	CONSTRAINT "site_sections_published_at_check" CHECK (status <> 'published' or published_at is not null)
);
--> statement-breakpoint
ALTER TABLE "cms"."site_sections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cms"."site_sections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cms"."help_articles" ADD CONSTRAINT "help_articles_category_fk" FOREIGN KEY ("org_id","category_id") REFERENCES "cms"."help_categories"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms"."help_feedback" ADD CONSTRAINT "help_feedback_article_fk" FOREIGN KEY ("org_id","article_id") REFERENCES "cms"."help_articles"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "status_fake_incidents_started_idx" ON "platform"."status_fake_incidents" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "contact_requests_org_id_idx" ON "cms"."contact_requests" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "contact_requests_org_status_created_idx" ON "cms"."contact_requests" USING btree ("org_id","status","created_at");--> statement-breakpoint
CREATE INDEX "help_articles_org_id_idx" ON "cms"."help_articles" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "help_articles_org_locale_slug_key" ON "cms"."help_articles" USING btree ("org_id","locale","slug");--> statement-breakpoint
CREATE INDEX "help_articles_org_category_status_idx" ON "cms"."help_articles" USING btree ("org_id","category_id","status","position");--> statement-breakpoint
CREATE INDEX "help_articles_org_locale_status_idx" ON "cms"."help_articles" USING btree ("org_id","locale","status");--> statement-breakpoint
CREATE INDEX "help_categories_org_id_idx" ON "cms"."help_categories" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "help_categories_org_slug_key" ON "cms"."help_categories" USING btree ("org_id","slug");--> statement-breakpoint
CREATE INDEX "help_categories_org_audience_position_idx" ON "cms"."help_categories" USING btree ("org_id","audience","position");--> statement-breakpoint
CREATE INDEX "help_feedback_org_id_idx" ON "cms"."help_feedback" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "help_feedback_org_article_voter_key" ON "cms"."help_feedback" USING btree ("org_id","article_id","voter_key");--> statement-breakpoint
CREATE INDEX "site_sections_org_id_idx" ON "cms"."site_sections" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "site_sections_org_placement_locale_slug_key" ON "cms"."site_sections" USING btree ("org_id","placement","locale","slug");--> statement-breakpoint
CREATE INDEX "site_sections_org_placement_status_idx" ON "cms"."site_sections" USING btree ("org_id","placement","status","position");--> statement-breakpoint
CREATE POLICY "contact_requests_tenant_isolation" ON "cms"."contact_requests" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "help_articles_tenant_isolation" ON "cms"."help_articles" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "help_categories_tenant_isolation" ON "cms"."help_categories" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "help_feedback_tenant_isolation" ON "cms"."help_feedback" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "site_sections_tenant_isolation" ON "cms"."site_sections" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin (M3.11b: org foreign keys of the new cms tables; the fake status page's functions)
ALTER TABLE "cms"."help_categories" ADD CONSTRAINT "help_categories_org_fk" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "cms"."help_articles" ADD CONSTRAINT "help_articles_org_fk" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "cms"."help_feedback" ADD CONSTRAINT "help_feedback_org_fk" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "cms"."site_sections" ADD CONSTRAINT "site_sections_org_fk" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "cms"."contact_requests" ADD CONSTRAINT "contact_requests_org_fk" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
-- The fake status page (global; no app_user table privileges).
REVOKE ALL ON platform.status_fake_incidents FROM app_user;
--> statement-breakpoint
-- Unresolved incidents plus those resolved in the last p_days days (at most 50), newest first.
CREATE FUNCTION platform.status_fake_recent(p_days integer)
RETURNS TABLE (
  id uuid, title text, impact text, status text, components text[], updates jsonb,
  started_at timestamptz, updated_at timestamptz, resolved_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT i.id, i.title, i.impact, i.status, i.components, i.updates, i.started_at, i.updated_at, i.resolved_at
  FROM platform.status_fake_incidents i
  WHERE i.resolved_at IS NULL OR i.resolved_at > now() - make_interval(days => least(greatest(p_days, 0), 90))
  ORDER BY i.started_at DESC
  LIMIT 50
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.status_fake_recent(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform.status_fake_recent(integer) TO app_user, platform_reader;
--> statement-breakpoint
-- Open an incident (or a maintenance window, which starts "in progress") with its first update.
CREATE FUNCTION platform.status_fake_post(
  p_title text, p_impact text, p_components text[], p_body text, p_actor text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  v_id uuid;
  v_status text := CASE WHEN p_impact = 'maintenance' THEN 'in_progress' ELSE 'investigating' END;
BEGIN
  IF p_body IS NULL OR char_length(btrim(p_body)) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'status_fake_post: invalid body' USING ERRCODE = '22023';
  END IF;
  IF p_actor IS NULL OR char_length(p_actor) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'status_fake_post: invalid actor' USING ERRCODE = '22023';
  END IF;
  IF coalesce(cardinality(p_components), 0) > 20 THEN
    RAISE EXCEPTION 'status_fake_post: too many components' USING ERRCODE = '22023';
  END IF;
  INSERT INTO platform.status_fake_incidents (title, impact, status, components, updates, created_by)
  VALUES (
    btrim(p_title), p_impact, v_status, coalesce(p_components, '{}'),
    jsonb_build_array(jsonb_build_object('status', v_status, 'body', btrim(p_body), 'at', now())),
    p_actor
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.status_fake_post(text, text, text[], text, text) FROM PUBLIC;
--> statement-breakpoint
-- Staff (platform_reader, audited) and the web's dev-only route for e2e (app_user): the fake is
-- never read in production, where the real provider is used.
GRANT EXECUTE ON FUNCTION platform.status_fake_post(text, text, text[], text, text) TO platform_reader, app_user;
--> statement-breakpoint
-- Add an update; "resolved" / "completed" close it. False when the incident is unknown or closed.
CREATE FUNCTION platform.status_fake_update(p_id uuid, p_status text, p_body text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE n integer;
BEGIN
  IF p_body IS NULL OR char_length(btrim(p_body)) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'status_fake_update: invalid body' USING ERRCODE = '22023';
  END IF;
  UPDATE platform.status_fake_incidents SET
    status = p_status,
    updates = updates || jsonb_build_array(jsonb_build_object('status', p_status, 'body', btrim(p_body), 'at', now())),
    updated_at = now(),
    resolved_at = CASE WHEN p_status IN ('resolved', 'completed') THEN now() ELSE NULL END
  WHERE id = p_id AND resolved_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.status_fake_update(uuid, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform.status_fake_update(uuid, text, text) TO platform_reader, app_user;
-- hand-written: end
