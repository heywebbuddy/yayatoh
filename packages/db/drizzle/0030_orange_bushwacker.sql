CREATE TABLE "platform"."access_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"actor" text NOT NULL,
	"reason" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."staff" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"added_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "staff_role_check" CHECK (role in ('admin', 'support', 'finance'))
);
--> statement-breakpoint
CREATE INDEX "access_log_at_idx" ON "platform"."access_log" USING btree ("at");--> statement-breakpoint
-- Staff and the access log are platform-only: no app_user privileges at all.
REVOKE ALL ON platform.staff FROM app_user;--> statement-breakpoint
REVOKE ALL ON platform.access_log FROM app_user;--> statement-breakpoint
REVOKE ALL ON platform.staff FROM platform_reader;--> statement-breakpoint
REVOKE ALL ON platform.access_log FROM platform_reader;--> statement-breakpoint
GRANT SELECT ON platform.staff TO platform_reader;--> statement-breakpoint
GRANT SELECT ON platform.access_log TO platform_reader;--> statement-breakpoint
-- Add, change or revoke a staff member by email (worker CLI, owner-approved list).
CREATE FUNCTION platform.set_staff(p_email text, p_role text, p_by text)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_user uuid;
BEGIN
  SELECT u.id INTO v_user FROM auth.users u WHERE lower(u.email) = lower(p_email);
  IF v_user IS NULL THEN RAISE EXCEPTION 'no user with that email' USING ERRCODE = 'P0002'; END IF;
  IF p_role IS NULL THEN
    UPDATE platform.staff SET revoked_at = now() WHERE user_id = v_user AND revoked_at IS NULL;
  ELSE
    INSERT INTO platform.staff (user_id, role, added_by) VALUES (v_user, p_role, p_by)
    ON CONFLICT (user_id) DO UPDATE SET role = excluded.role, added_by = excluded.added_by,
      created_at = now(), revoked_at = NULL;
  END IF;
  RETURN v_user;
END
$$;
--> statement-breakpoint
CREATE FUNCTION platform.log_access(p_actor text, p_reason text)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
  INSERT INTO platform.access_log (actor, reason) VALUES (left(p_actor, 200), left(p_reason, 1000))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.set_staff(text, text, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.log_access(text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform.set_staff(text, text, text) TO platform_reader;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform.log_access(text, text) TO platform_reader;
