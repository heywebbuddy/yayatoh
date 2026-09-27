CREATE TABLE "checkin"."devices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"label" text NOT NULL,
	"token_hash" text NOT NULL,
	"enrolled_by" uuid,
	"last_seen_at" timestamp with time zone,
	"battery_pct" integer,
	"queue_depth" integer,
	"clock_offset_ms" integer,
	"wipe_requested_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "devices_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "devices_battery_check" CHECK (battery_pct is null or battery_pct between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "checkin"."devices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "checkin"."devices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "checkin"."admissions" ADD COLUMN "device_id" uuid;--> statement-breakpoint
ALTER TABLE "checkin"."scans" ADD COLUMN "device_id" uuid;--> statement-breakpoint
ALTER TABLE "checkin"."scans" ADD COLUMN "device_ts" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "checkin"."scans" ADD COLUMN "clock_offset_ms" integer;--> statement-breakpoint
ALTER TABLE "checkin"."scans" ADD COLUMN "offline" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "devices_org_id_idx" ON "checkin"."devices" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_token_hash_key" ON "checkin"."devices" USING btree ("token_hash");--> statement-breakpoint
-- Widen the result check without a long lock: add the new one NOT VALID, validate, drop the old.
ALTER TABLE "checkin"."scans" ADD CONSTRAINT "scans_result_check_v2" CHECK (result in ('admitted', 'duplicate', 'invalid', 'void', 'wrong_event', 'not_today', 'outside_window', 'duplicate_offline', 'superseded', 'provisional')) NOT VALID;--> statement-breakpoint
ALTER TABLE "checkin"."scans" VALIDATE CONSTRAINT "scans_result_check_v2";--> statement-breakpoint
ALTER TABLE "checkin"."scans" DROP CONSTRAINT "scans_result_check";--> statement-breakpoint
ALTER TABLE "checkin"."scans" RENAME CONSTRAINT "scans_result_check_v2" TO "scans_result_check";--> statement-breakpoint
CREATE POLICY "devices_tenant_isolation" ON "checkin"."devices" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));
--> statement-breakpoint
ALTER TABLE "checkin"."admissions" ADD CONSTRAINT "admissions_device_fk" FOREIGN KEY ("org_id","device_id") REFERENCES "checkin"."devices"("org_id","id") NOT VALID;--> statement-breakpoint
ALTER TABLE "checkin"."admissions" VALIDATE CONSTRAINT "admissions_device_fk";--> statement-breakpoint
ALTER TABLE "checkin"."scans" ADD CONSTRAINT "scans_device_fk" FOREIGN KEY ("org_id","device_id") REFERENCES "checkin"."devices"("org_id","id") NOT VALID;--> statement-breakpoint
ALTER TABLE "checkin"."scans" VALIDATE CONSTRAINT "scans_device_fk";--> statement-breakpoint
-- A device's bearer token resolves to (org, device) before any tenant is known. Allowlisted
-- columns only; revoked devices resolve to nothing.
CREATE FUNCTION checkin.device_by_token(p_token_hash text)
RETURNS TABLE (org_id uuid, device_id uuid, wipe_requested boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT d.org_id, d.id, d.wipe_requested_at IS NOT NULL
  FROM checkin.devices d
  JOIN tenancy.organizations o ON o.id = d.org_id AND o.status IN ('active', 'limited')
  WHERE d.token_hash = p_token_hash AND d.revoked_at IS NULL
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION checkin.device_by_token(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION checkin.device_by_token(text) TO app_user;
