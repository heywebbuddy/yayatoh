CREATE TABLE "platform"."api_usage" (
	"day" date NOT NULL,
	"route" text NOT NULL,
	"method" text NOT NULL,
	"client" text NOT NULL,
	"app_version" text NOT NULL,
	"count" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "api_usage_pkey" PRIMARY KEY("day","route","method","client","app_version"),
	CONSTRAINT "api_usage_lengths" CHECK (length(route) <= 200 and length(client) <= 40 and length(app_version) <= 40)
);
--> statement-breakpoint
CREATE TABLE "tenancy"."api_keys" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" text[] NOT NULL,
	"created_by" uuid,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	CONSTRAINT "api_keys_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "api_keys_name_length" CHECK (length(name) between 1 and 60),
	CONSTRAINT "api_keys_scopes_check" CHECK (cardinality(scopes) >= 1 and scopes <@ array['org:read', 'events:read', 'events:write', 'orders:read', 'orders:refund', 'attendees:read', 'checkin:scan']::text[])
);
--> statement-breakpoint
ALTER TABLE "tenancy"."api_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenancy"."api_keys" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenancy"."api_keys" ADD CONSTRAINT "api_keys_org_fk" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_org_id_idx" ON "tenancy"."api_keys" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "tenancy"."api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE POLICY "api_keys_tenant_isolation" ON "tenancy"."api_keys" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
-- hand-written: begin
-- An org API key resolves to (org, key, scopes) before any tenant is known. Allowlisted columns
-- only; revoked keys and keys of suspended or terminated orgs resolve to nothing.
CREATE FUNCTION tenancy.api_key_by_hash(p_key_hash text)
RETURNS TABLE (org_id uuid, key_id uuid, scopes text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT k.org_id, k.id, k.scopes
  FROM tenancy.api_keys k
  JOIN tenancy.organizations o ON o.id = k.org_id AND o.status IN ('active', 'limited')
  WHERE k.key_hash = p_key_hash AND k.revoked_at IS NULL
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION tenancy.api_key_by_hash(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenancy.api_key_by_hash(text) TO app_user;
--> statement-breakpoint
REVOKE ALL ON platform.api_usage FROM app_user;
--> statement-breakpoint
REVOKE ALL ON platform.api_usage FROM platform_reader;
--> statement-breakpoint
GRANT SELECT ON platform.api_usage TO platform_reader;
--> statement-breakpoint
-- /v1 app-version telemetry: one counter per day × route × client × version, incremented only.
CREATE FUNCTION platform.record_api_usage(p_route text, p_method text, p_client text, p_app_version text)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
  INSERT INTO platform.api_usage AS u (day, route, method, client, app_version, count)
  VALUES ((now() AT TIME ZONE 'UTC')::date, left(p_route, 200), left(p_method, 10), left(p_client, 40), left(p_app_version, 40), 1)
  ON CONFLICT (day, route, method, client, app_version) DO UPDATE SET count = u.count + 1
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.record_api_usage(text, text, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform.record_api_usage(text, text, text, text) TO app_user;
-- hand-written: end
