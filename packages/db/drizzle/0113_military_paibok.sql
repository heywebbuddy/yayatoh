CREATE TABLE "crm"."contact_merge_moves" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"merge_id" uuid NOT NULL,
	"module" text NOT NULL,
	"ref_table" text NOT NULL,
	"row_id" uuid NOT NULL,
	CONSTRAINT "contact_merge_moves_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "contact_merge_moves_module_check" CHECK (module ~ '^[a-z][a-z_-]{1,40}$'),
	CONSTRAINT "contact_merge_moves_table_check" CHECK (ref_table ~ '^[a-z][a-z_]{1,40}\.[a-z][a-z_]{1,60}$')
);
--> statement-breakpoint
ALTER TABLE "crm"."contact_merge_moves" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm"."contact_merge_moves" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "crm"."contact_merges" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_contact_id" uuid NOT NULL,
	"target_contact_id" uuid NOT NULL,
	"status" text DEFAULT 'applied' NOT NULL,
	"choices" jsonb NOT NULL,
	"snapshot" jsonb,
	"consent_row_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"bulk_id" uuid,
	"merged_by" text NOT NULL,
	"merged_at" timestamp with time zone NOT NULL,
	"undo_until" timestamp with time zone NOT NULL,
	"undone_by" text,
	"undone_at" timestamp with time zone,
	CONSTRAINT "contact_merges_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "contact_merges_status_check" CHECK (status in ('applied', 'undone')),
	CONSTRAINT "contact_merges_distinct_check" CHECK (source_contact_id <> target_contact_id),
	CONSTRAINT "contact_merges_undone_check" CHECK ((status = 'undone') = (undone_at is not null)),
	CONSTRAINT "contact_merges_undo_window_check" CHECK (undo_until > merged_at),
	CONSTRAINT "contact_merges_actor_check" CHECK (length(merged_by) between 1 and 200),
	CONSTRAINT "contact_merges_undone_by_check" CHECK (undone_by is null or length(undone_by) between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "crm"."contact_merges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm"."contact_merges" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "crm"."duplicate_candidates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"contact_a_id" uuid NOT NULL,
	"contact_b_id" uuid NOT NULL,
	"score" integer NOT NULL,
	"reasons" text[] NOT NULL,
	"name_similarity" integer,
	"company_similarity" integer,
	"status" text DEFAULT 'open' NOT NULL,
	"detected_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	CONSTRAINT "duplicate_candidates_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "duplicate_candidates_order_check" CHECK (contact_a_id < contact_b_id),
	CONSTRAINT "duplicate_candidates_score_check" CHECK (score between 0 and 100),
	CONSTRAINT "duplicate_candidates_reasons_check" CHECK (cardinality(reasons) between 1 and 3 and reasons <@ array['email', 'phone', 'name_company']::text[]),
	CONSTRAINT "duplicate_candidates_similarity_check" CHECK ((name_similarity is null or name_similarity between 0 and 100) and (company_similarity is null or company_similarity between 0 and 100)),
	CONSTRAINT "duplicate_candidates_status_check" CHECK (status in ('open', 'dismissed', 'merged')),
	CONSTRAINT "duplicate_candidates_resolved_check" CHECK ((status = 'open') = (resolved_at is null)),
	CONSTRAINT "duplicate_candidates_resolved_by_check" CHECK (resolved_by is null or length(resolved_by) <= 200)
);
--> statement-breakpoint
ALTER TABLE "crm"."duplicate_candidates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm"."duplicate_candidates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "crm"."duplicate_scans" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cursor_at" timestamp with time zone,
	"last_run_at" timestamp with time zone NOT NULL,
	"last_full_at" timestamp with time zone,
	"contacts_scanned" integer DEFAULT 0 NOT NULL,
	"pairs_found" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "duplicate_scans_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "duplicate_scans_counts_check" CHECK (contacts_scanned >= 0 and pairs_found >= 0)
);
--> statement-breakpoint
ALTER TABLE "crm"."duplicate_scans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm"."duplicate_scans" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "crm"."timeline_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"contact_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"event_id" uuid,
	"source_ref" uuid NOT NULL,
	"subject_table" text,
	"subject_ref" uuid,
	"amount_minor" bigint,
	"currency" text,
	"label" text,
	CONSTRAINT "timeline_entries_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "timeline_entries_kind_check" CHECK (kind in ('order_paid', 'order_refunded', 'checked_in', 'session_attended', 'campaign_sent', 'campaign_opened', 'campaign_clicked', 'message_in', 'message_out', 'donation', 'rsvp', 'survey_sent', 'survey_responded')),
	CONSTRAINT "timeline_entries_currency_check" CHECK (currency is null or currency ~ '^[A-Z]{3}$'),
	CONSTRAINT "timeline_entries_amount_check" CHECK ((amount_minor is null) = (currency is null)),
	CONSTRAINT "timeline_entries_subject_check" CHECK ((subject_ref is null) = (subject_table is null) and (subject_table is null or subject_table ~ '^[a-z][a-z_]{1,40}\.[a-z][a-z_]{1,60}$')),
	CONSTRAINT "timeline_entries_label_length" CHECK (label is null or length(label) between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "crm"."timeline_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm"."timeline_entries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm"."contacts" ADD COLUMN "company" text;--> statement-breakpoint
ALTER TABLE "crm"."contact_merge_moves" ADD CONSTRAINT "contact_merge_moves_merge_fk" FOREIGN KEY ("org_id","merge_id") REFERENCES "crm"."contact_merges"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."contact_merges" ADD CONSTRAINT "contact_merges_source_fk" FOREIGN KEY ("org_id","source_contact_id") REFERENCES "crm"."contacts"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."contact_merges" ADD CONSTRAINT "contact_merges_target_fk" FOREIGN KEY ("org_id","target_contact_id") REFERENCES "crm"."contacts"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_a_fk" FOREIGN KEY ("org_id","contact_a_id") REFERENCES "crm"."contacts"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_b_fk" FOREIGN KEY ("org_id","contact_b_id") REFERENCES "crm"."contacts"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."timeline_entries" ADD CONSTRAINT "timeline_entries_contact_fk" FOREIGN KEY ("org_id","contact_id") REFERENCES "crm"."contacts"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_merge_moves_org_id_idx" ON "crm"."contact_merge_moves" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_merge_moves_org_merge_row_key" ON "crm"."contact_merge_moves" USING btree ("org_id","merge_id","ref_table","row_id");--> statement-breakpoint
CREATE INDEX "contact_merges_org_id_idx" ON "crm"."contact_merges" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "contact_merges_org_target_idx" ON "crm"."contact_merges" USING btree ("org_id","target_contact_id","merged_at");--> statement-breakpoint
CREATE INDEX "contact_merges_org_merged_idx" ON "crm"."contact_merges" USING btree ("org_id","merged_at");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_merges_org_source_applied_key" ON "crm"."contact_merges" USING btree ("org_id","source_contact_id") WHERE status = 'applied';--> statement-breakpoint
CREATE INDEX "duplicate_candidates_org_id_idx" ON "crm"."duplicate_candidates" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "duplicate_candidates_org_pair_key" ON "crm"."duplicate_candidates" USING btree ("org_id","contact_a_id","contact_b_id");--> statement-breakpoint
CREATE INDEX "duplicate_candidates_org_status_score_idx" ON "crm"."duplicate_candidates" USING btree ("org_id","status","score","id");--> statement-breakpoint
CREATE INDEX "duplicate_candidates_org_b_idx" ON "crm"."duplicate_candidates" USING btree ("org_id","contact_b_id");--> statement-breakpoint
CREATE INDEX "duplicate_scans_org_id_idx" ON "crm"."duplicate_scans" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "duplicate_scans_org_key" ON "crm"."duplicate_scans" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "timeline_entries_org_id_idx" ON "crm"."timeline_entries" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "timeline_entries_org_kind_source_key" ON "crm"."timeline_entries" USING btree ("org_id","kind","source_ref");--> statement-breakpoint
CREATE INDEX "timeline_entries_org_contact_time_idx" ON "crm"."timeline_entries" USING btree ("org_id","contact_id","occurred_at","id");--> statement-breakpoint
CREATE INDEX "timeline_entries_org_subject_idx" ON "crm"."timeline_entries" USING btree ("org_id","subject_table","subject_ref") WHERE subject_ref is not null;--> statement-breakpoint
-- hand-written: begin
-- M6.1a: three indexes on the existing crm.contacts. drizzle's migrator runs each migration in one
-- transaction, so CONCURRENTLY is not possible here: on a large production table the owner's
-- runbook creates them CONCURRENTLY first (same names) and these find them (IF NOT EXISTS). The
-- trigram operator class is qualified with the `extensions` schema (pg_trgm, migration 0055).
CREATE INDEX IF NOT EXISTS "contacts_name_trgm_idx" ON "crm"."contacts" USING gin ("name" "extensions".gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contacts_org_updated_idx" ON "crm"."contacts" USING btree ("org_id","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contacts_org_phone_idx" ON "crm"."contacts" USING btree ("org_id","phone_e164") WHERE phone_e164 is not null;--> statement-breakpoint
-- A CHECK on an existing table: NOT VALID, then VALIDATE (no long lock while it scans).
ALTER TABLE "crm"."contacts" ADD CONSTRAINT "contacts_company_length" CHECK (company is null or length(company) between 1 and 200) NOT VALID;--> statement-breakpoint
ALTER TABLE "crm"."contacts" VALIDATE CONSTRAINT "contacts_company_length";--> statement-breakpoint
-- Duplicate detection (M6.1a): contact pairs with similar names (pg_trgm), in the caller's own org
-- (the same `app.org_id` the tenant policy reads; unset = nothing). Under row-level security the
-- planner never uses the trigram index for `%` (not LEAKPROOF), so this runs as the owner and
-- returns ids and similarities only. Merged and erased contacts never match. `p_ids` null = every
-- contact (a full scan); otherwise pairs that involve one of them (incremental).
CREATE FUNCTION crm.similar_contact_pairs(p_ids uuid[], p_threshold real)
RETURNS TABLE (a uuid, b uuid, name_sim real, company_sim real)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT LEAST(x.id, y.id), GREATEST(x.id, y.id),
         extensions.similarity(x.name, y.name),
         CASE WHEN x.company IS NULL OR y.company IS NULL THEN NULL
              ELSE extensions.similarity(x.company, y.company) END
  FROM crm.contacts x
  JOIN crm.contacts y
    ON y.org_id = x.org_id AND y.id <> x.id
   AND y.name OPERATOR(extensions.%) x.name
  WHERE x.org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)
    AND (p_ids IS NULL OR x.id = ANY (p_ids))
    AND x.name IS NOT NULL AND y.name IS NOT NULL
    AND x.merged_into IS NULL AND y.merged_into IS NULL
    AND x.email_norm NOT LIKE '%@erased.invalid' AND y.email_norm NOT LIKE '%@erased.invalid'
    AND extensions.similarity(x.name, y.name) >= p_threshold
  GROUP BY 1, 2, 3, 4
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION crm.similar_contact_pairs(uuid[], real) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION crm.similar_contact_pairs(uuid[], real) TO app_user;--> statement-breakpoint
-- The scan job (worker, platform_reader): orgs with contacts changed since their last duplicate
-- scan (or never scanned). Ids only.
CREATE FUNCTION crm.orgs_needing_duplicate_scan(p_limit integer)
RETURNS TABLE (org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT c.org_id FROM crm.contacts c
  LEFT JOIN crm.duplicate_scans s ON s.org_id = c.org_id
  GROUP BY c.org_id, s.cursor_at
  HAVING s.cursor_at IS NULL OR max(c.updated_at) > s.cursor_at
  LIMIT p_limit
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION crm.orgs_needing_duplicate_scan(integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION crm.orgs_needing_duplicate_scan(integer) TO platform_reader;--> statement-breakpoint
-- hand-written: end
CREATE POLICY "contact_merge_moves_tenant_isolation" ON "crm"."contact_merge_moves" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "contact_merges_tenant_isolation" ON "crm"."contact_merges" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "duplicate_candidates_tenant_isolation" ON "crm"."duplicate_candidates" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "duplicate_scans_tenant_isolation" ON "crm"."duplicate_scans" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "timeline_entries_tenant_isolation" ON "crm"."timeline_entries" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));