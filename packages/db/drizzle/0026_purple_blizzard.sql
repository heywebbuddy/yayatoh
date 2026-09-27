CREATE TABLE "platform"."signup_codes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code_hash" text NOT NULL,
	"max_uses" integer NOT NULL,
	"uses" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"note" text DEFAULT '' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signup_codes_uses_check" CHECK (uses >= 0 and uses <= max_uses and max_uses between 1 and 1000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "signup_codes_code_hash_key" ON "platform"."signup_codes" USING btree ("code_hash");--> statement-breakpoint-- Nobody reads this table directly: app_user checks and claims codes through the functions
-- below; platform staff (platform_reader, apps/admin and the worker CLI) create and list them.
REVOKE ALL ON platform.signup_codes FROM app_user;--> statement-breakpoint
REVOKE ALL ON platform.signup_codes FROM platform_reader;--> statement-breakpoint
CREATE FUNCTION platform.signup_code_valid(p_hash text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1 FROM platform.signup_codes c
    WHERE c.code_hash = p_hash AND c.revoked_at IS NULL AND c.expires_at > now() AND c.uses < c.max_uses
  )
$$;
--> statement-breakpoint
-- Claim one use atomically (inside the signup transaction): true when a use was taken.
CREATE FUNCTION platform.claim_signup_code(p_hash text)
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
  WITH claimed AS (
    UPDATE platform.signup_codes c SET uses = c.uses + 1
    WHERE c.code_hash = p_hash AND c.revoked_at IS NULL AND c.expires_at > now() AND c.uses < c.max_uses
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM claimed)
$$;
--> statement-breakpoint
CREATE FUNCTION platform.create_signup_code(
  p_hash text, p_max_uses integer, p_expires_at timestamptz, p_note text, p_created_by text
)
RETURNS uuid
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
  INSERT INTO platform.signup_codes (code_hash, max_uses, expires_at, note, created_by)
  VALUES (p_hash, p_max_uses, p_expires_at, p_note, p_created_by)
  RETURNING id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.signup_code_valid(text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.claim_signup_code(text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.create_signup_code(text, integer, timestamptz, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform.signup_code_valid(text) TO app_user;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform.claim_signup_code(text) TO app_user;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform.create_signup_code(text, integer, timestamptz, text, text) TO platform_reader;
