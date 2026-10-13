ALTER TABLE "notifications"."push_tokens" ADD COLUMN "app_id" text;--> statement-breakpoint
ALTER TABLE "notifications"."push_tokens" ADD COLUMN "app_version" text;--> statement-breakpoint
ALTER TABLE "notifications"."push_tokens" ADD COLUMN "locale" text;--> statement-breakpoint
ALTER TABLE "notifications"."push_tokens" ADD COLUMN "environment" text;--> statement-breakpoint
CREATE INDEX "tickets_holder_email_lower_idx" ON "ticketing"."tickets" USING btree (lower(holder_email));--> statement-breakpoint
ALTER TABLE "notifications"."push_tokens" ADD CONSTRAINT "push_tokens_environment_check" CHECK (environment is null or environment in ('sandbox', 'production')) NOT VALID;--> statement-breakpoint
ALTER TABLE "notifications"."push_tokens" ADD CONSTRAINT "push_tokens_app_id_length" CHECK (app_id is null or length(app_id) between 3 and 155) NOT VALID;--> statement-breakpoint
ALTER TABLE "notifications"."push_tokens" ADD CONSTRAINT "push_tokens_app_version_length" CHECK (app_version is null or length(app_version) between 1 and 40) NOT VALID;--> statement-breakpoint
ALTER TABLE "notifications"."push_tokens" ADD CONSTRAINT "push_tokens_locale_length" CHECK (locale is null or length(locale) between 2 and 12) NOT VALID;--> statement-breakpoint
ALTER TABLE "notifications"."push_tokens" VALIDATE CONSTRAINT "push_tokens_environment_check";--> statement-breakpoint
ALTER TABLE "notifications"."push_tokens" VALIDATE CONSTRAINT "push_tokens_app_id_length";--> statement-breakpoint
ALTER TABLE "notifications"."push_tokens" VALIDATE CONSTRAINT "push_tokens_app_version_length";--> statement-breakpoint
ALTER TABLE "notifications"."push_tokens" VALIDATE CONSTRAINT "push_tokens_locale_length";--> statement-breakpoint
-- hand-written: begin
-- M7.2c native push. The phone belongs to a person (their verified email), not to an org, so these
-- SECURITY DEFINER functions (owner: migrator, BYPASSRLS) read and write the device rows across
-- orgs, for the signed-in person's own address only. Tenant code never lists other orgs.

-- The orgs where an address has a sold order or an active ticket: the only orgs a phone is stored in.
CREATE FUNCTION notifications.app_orgs_by_email(p_email text)
RETURNS TABLE (org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT u.org_id FROM (
    SELECT o.org_id FROM orders.orders o
    WHERE o.buyer_email = lower(btrim(p_email)) AND o.status IN ('paid', 'partially_refunded', 'refunded')
    UNION
    SELECT t.org_id FROM ticketing.tickets t
    WHERE lower(t.holder_email) = lower(btrim(p_email)) AND t.status = 'active'
  ) u
  JOIN tenancy.organizations g ON g.id = u.org_id AND g.status = 'active'
  LIMIT 500
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION notifications.app_orgs_by_email(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION notifications.app_orgs_by_email(text) TO app_user;
--> statement-breakpoint
-- A person's active app devices (one row per device, newest first) from any org: a new org copies them.
CREATE FUNCTION notifications.app_devices_by_email(p_email_norm text)
RETURNS TABLE (
  platform text, token text, app_id text, app_version text, locale text, time_zone text, environment text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT d.platform, d.token, d.app_id, d.app_version, d.locale, d.time_zone, d.environment FROM (
    SELECT DISTINCT ON (k.platform, k.token)
      k.platform, k.token, k.app_id, k.app_version, k.locale, k.time_zone, k.environment, k.last_seen_at
    FROM notifications.push_tokens k
    WHERE k.email_norm = p_email_norm AND k.source = 'app' AND k.disabled_at IS NULL
      AND k.platform IN ('fcm', 'apns')
    ORDER BY k.platform, k.token, k.last_seen_at DESC
  ) d
  ORDER BY d.last_seen_at DESC
  LIMIT 20
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION notifications.app_devices_by_email(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION notifications.app_devices_by_email(text) TO app_user;
--> statement-breakpoint
-- The phone changed hands: every app row of this token owned by someone else goes (in every org),
-- so the previous owner's pushes stop reaching the phone the new owner signed in on.
CREATE FUNCTION notifications.app_device_release(p_platform text, p_token text, p_email_norm text)
RETURNS integer
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
  WITH gone AS (
    DELETE FROM notifications.push_tokens k
    WHERE k.platform = p_platform AND k.token = p_token AND k.source = 'app'
      AND k.email_norm IS NOT NULL AND k.email_norm <> p_email_norm
    RETURNING 1
  )
  SELECT count(*)::integer FROM gone
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION notifications.app_device_release(text, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION notifications.app_device_release(text, text, text) TO app_user;
--> statement-breakpoint
-- Sign-out: this person's rows for the token, in every org. Only their own rows (their address).
CREATE FUNCTION notifications.app_device_remove(p_email_norm text, p_token text)
RETURNS integer
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
  WITH gone AS (
    DELETE FROM notifications.push_tokens k
    WHERE k.email_norm = p_email_norm AND k.token = p_token AND k.source = 'app'
    RETURNING 1
  )
  SELECT count(*)::integer FROM gone
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION notifications.app_device_remove(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION notifications.app_device_remove(text, text) TO app_user;
--> statement-breakpoint
-- Account deletion and "sign out everywhere": all of this person's app devices, in every org.
CREATE FUNCTION notifications.app_devices_purge(p_email_norm text)
RETURNS integer
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
  WITH gone AS (
    DELETE FROM notifications.push_tokens k
    WHERE k.email_norm = p_email_norm AND k.source = 'app'
    RETURNING 1
  )
  SELECT count(*)::integer FROM gone
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION notifications.app_devices_purge(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION notifications.app_devices_purge(text) TO app_user;
-- hand-written: end
