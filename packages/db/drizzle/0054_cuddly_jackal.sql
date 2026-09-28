CREATE TABLE "platform"."erased_addresses" (
	"address_hash" text PRIMARY KEY NOT NULL,
	"reason" text DEFAULT 'erased' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"account_lifted_at" timestamp with time zone,
	CONSTRAINT "erased_addresses_hash_check" CHECK (address_hash ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "erased_addresses_reason_check" CHECK (reason in ('erased'))
);
--> statement-breakpoint
CREATE TABLE "privacy"."account_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"subject_ref" text NOT NULL,
	"subject_hint" text NOT NULL,
	"actor" text NOT NULL,
	"reason" text,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_requests_kind_check" CHECK (kind in ('access', 'erasure')),
	CONSTRAINT "account_requests_subject_ref_check" CHECK (subject_ref ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "account_requests_actor_check" CHECK (actor = 'self' or actor ~ '^staff:[0-9a-f-]{36}$'),
	CONSTRAINT "account_requests_reason_check" CHECK ((actor = 'self' and reason is null) or (actor <> 'self' and length(btrim(reason)) between 10 and 500))
);
--> statement-breakpoint
ALTER TABLE "auth"."users" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "account_requests_created_idx" ON "privacy"."account_requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "account_requests_subject_idx" ON "privacy"."account_requests" USING btree ("subject_ref");--> statement-breakpoint
-- hand-written: begin (M1.14e platform-wide erased-address suppression; global, no app_user table privileges)
REVOKE ALL ON platform.erased_addresses FROM app_user;
--> statement-breakpoint
-- Add (or renew) an erased address. A repeat erasure restarts the clock: consents and the
-- account lift given before it no longer count.
CREATE FUNCTION platform.erased_address_add(p_hash text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'erased_address_add: invalid hash' USING ERRCODE = '22023';
  END IF;
  INSERT INTO platform.erased_addresses (address_hash, reason, created_at, account_lifted_at)
    VALUES (p_hash, 'erased', now(), NULL)
    ON CONFLICT (address_hash) DO UPDATE SET created_at = now(), account_lifted_at = NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.erased_address_add(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform.erased_address_add(text) TO app_user;
--> statement-breakpoint
-- Which of these hashes are erased (at most 1000 per call), and whether the account mail was lifted.
CREATE FUNCTION platform.erased_address_lookup(p_hashes text[])
RETURNS TABLE (address_hash text, erased_at timestamptz, account_lifted_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF coalesce(cardinality(p_hashes), 0) > 1000 THEN
    RAISE EXCEPTION 'erased_address_lookup: at most 1000 hashes' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY SELECT e.address_hash, e.created_at, e.account_lifted_at
    FROM platform.erased_addresses e WHERE e.address_hash = ANY (p_hashes);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.erased_address_lookup(text[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform.erased_address_lookup(text[]) TO app_user, platform_reader;
--> statement-breakpoint
-- The person signed up again: account mail reaches them (org marketing still needs a new consent).
CREATE FUNCTION platform.erased_address_lift_account(p_hash text) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  WITH u AS (
    UPDATE platform.erased_addresses SET account_lifted_at = now()
    WHERE address_hash = p_hash AND account_lifted_at IS NULL RETURNING 1
  )
  SELECT count(*) > 0 FROM u
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.erased_address_lift_account(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform.erased_address_lift_account(text) TO app_user;
--> statement-breakpoint
-- Signup-code notes (free text written by staff) that mention an erased address are redacted.
CREATE FUNCTION platform.redact_signup_code_notes(p_email text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE n integer;
BEGIN
  IF p_email IS NULL OR length(btrim(p_email)) < 3 OR position('@' in p_email) = 0 THEN
    RETURN 0;
  END IF;
  UPDATE platform.signup_codes SET note = '[erased]'
    WHERE position(lower(btrim(p_email)) in lower(note)) > 0;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.redact_signup_code_notes(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform.redact_signup_code_notes(text) TO app_user;
--> statement-breakpoint
-- Staff DSAR lookup (platform_reader has no access to signup codes): how many codes this person
-- created, or whose staff note mentions the address. A count only.
CREATE FUNCTION platform.signup_code_mentions(p_email text, p_creator text) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT count(*)::integer FROM platform.signup_codes
  WHERE (length(btrim(p_email)) >= 3 AND position(lower(btrim(p_email)) in lower(note)) > 0)
     OR (p_creator IS NOT NULL AND created_by = p_creator)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.signup_code_mentions(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform.signup_code_mentions(text, text) TO platform_reader;
--> statement-breakpoint
-- M1.14e controller-side DSAR record (global; no app_user table privileges).
REVOKE ALL ON privacy.account_requests FROM app_user;
--> statement-breakpoint
CREATE FUNCTION privacy.record_account_request(
  p_kind text, p_ref text, p_hint text, p_actor text, p_reason text, p_summary jsonb
) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  INSERT INTO privacy.account_requests (kind, subject_ref, subject_hint, actor, reason, summary)
  VALUES (p_kind, p_ref, p_hint, p_actor, p_reason, coalesce(p_summary, '{}'::jsonb))
  RETURNING id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION privacy.record_account_request(text, text, text, text, text, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION privacy.record_account_request(text, text, text, text, text, jsonb) TO app_user;
--> statement-breakpoint
-- Orgs holding team invitations addressed to an email (any state), for a person's own DSAR.
-- Returns org ids only; each org's rows are then read under its own RLS.
CREATE FUNCTION tenancy.invitation_orgs(p_email text) RETURNS TABLE (org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT DISTINCT i.org_id FROM tenancy.invitations i WHERE i.email = lower(btrim(p_email))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION tenancy.invitation_orgs(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenancy.invitation_orgs(text) TO app_user;
--> statement-breakpoint
-- Orgs where a person bought (linked to their account, or with their email), for their own DSAR.
CREATE FUNCTION orders.buyer_orgs(p_user uuid, p_email text) RETURNS TABLE (org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT DISTINCT o.org_id FROM orders.orders o
  WHERE (p_user IS NOT NULL AND o.buyer_user_id = p_user) OR o.buyer_email = lower(btrim(p_email))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION orders.buyer_orgs(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION orders.buyer_orgs(uuid, text) TO app_user;
-- hand-written: end
