CREATE SCHEMA "applications";
--> statement-breakpoint
CREATE TABLE "applications"."events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"application_id" uuid NOT NULL,
	"action" text NOT NULL,
	"actor" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_events_action_check" CHECK (char_length(action) between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "applications"."notes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"application_id" uuid NOT NULL,
	"body" text NOT NULL,
	"author" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_notes_body_check" CHECK (char_length(body) between 1 and 2000)
);
--> statement-breakpoint
CREATE TABLE "applications"."applications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"org_name" text NOT NULL,
	"org_type" text NOT NULL,
	"country" text NOT NULL,
	"website" text,
	"contact_name" text NOT NULL,
	"contact_email" text NOT NULL,
	"contact_phone" text,
	"event_types" text[] NOT NULL,
	"events_per_year" text NOT NULL,
	"expected_tickets" text NOT NULL,
	"plan_interest" text NOT NULL,
	"white_label" boolean NOT NULL,
	"message" text,
	"preferred_time" timestamp with time zone,
	"timezone" text,
	"locale" text NOT NULL,
	"assigned_to" text,
	"approved_plan" text,
	"signup_code_id" uuid,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "applications_kind_check" CHECK (kind in ('apply', 'demo')),
	CONSTRAINT "applications_status_check" CHECK (status in ('new', 'in_review', 'approved', 'rejected', 'needs_info')),
	CONSTRAINT "applications_demo_time_check" CHECK (kind <> 'demo' or preferred_time is not null),
	CONSTRAINT "applications_country_check" CHECK (country ~ '^[A-Z]{2}$'),
	CONSTRAINT "applications_email_check" CHECK (contact_email = lower(contact_email) and contact_email like '%@%'),
	CONSTRAINT "applications_text_check" CHECK (char_length(org_name) between 2 and 160 and char_length(contact_name) between 2 and 120),
	CONSTRAINT "applications_message_check" CHECK (message is null or char_length(message) <= 2000),
	CONSTRAINT "applications_approved_check" CHECK ((status = 'approved') = (signup_code_id is not null))
);
--> statement-breakpoint
ALTER TABLE "platform"."signup_codes" ADD COLUMN "bound_email" text;--> statement-breakpoint
ALTER TABLE "platform"."signup_codes" ADD COLUMN "plan_key" text;--> statement-breakpoint
ALTER TABLE "platform"."signup_codes" ADD COLUMN "application_id" uuid;--> statement-breakpoint
ALTER TABLE "applications"."events" ADD CONSTRAINT "events_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "applications"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications"."notes" ADD CONSTRAINT "notes_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "applications"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "application_events_app_idx" ON "applications"."events" USING btree ("application_id","at");--> statement-breakpoint
CREATE INDEX "application_notes_app_idx" ON "applications"."notes" USING btree ("application_id","created_at");--> statement-breakpoint
CREATE INDEX "applications_status_created_idx" ON "applications"."applications" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "applications_email_idx" ON "applications"."applications" USING btree ("contact_email");
--> statement-breakpoint
-- hand-written: begin (organizer applications: the public form writes through applications.submit,
-- staff read the tables and change them only through the applications.* functions below)
REVOKE ALL ON applications.applications, applications.notes, applications.events FROM app_user;--> statement-breakpoint
REVOKE ALL ON applications.applications, applications.notes, applications.events FROM platform_reader;--> statement-breakpoint
GRANT SELECT ON applications.applications, applications.notes, applications.events TO platform_reader;--> statement-breakpoint
CREATE FUNCTION applications.submit(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_id uuid; v_email text := lower(p->>'contactEmail');
BEGIN
  -- the same person asking for the same thing again while it is still open: one record, not two
  SELECT a.id INTO v_id FROM applications.applications a
   WHERE a.contact_email = v_email AND a.kind = p->>'kind'
     AND a.status IN ('new', 'in_review', 'needs_info') AND a.created_at > now() - interval '7 days'
   ORDER BY a.created_at DESC LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('id', v_id, 'duplicate', true); END IF;
  INSERT INTO applications.applications (kind, org_name, org_type, country, website, contact_name, contact_email,
    contact_phone, event_types, events_per_year, expected_tickets, plan_interest, white_label, message,
    preferred_time, timezone, locale)
  VALUES (p->>'kind', p->>'orgName', p->>'orgType', upper(p->>'country'), nullif(p->>'website', ''), p->>'contactName', v_email,
    nullif(p->>'contactPhone', ''), ARRAY(SELECT jsonb_array_elements_text(p->'eventTypes')), p->>'eventsPerYear',
    p->>'expectedTickets', p->>'planInterest', (p->>'whiteLabel')::boolean, nullif(p->>'message', ''),
    nullif(p->>'preferredTime', '')::timestamptz, nullif(p->>'timezone', ''), p->>'locale')
  RETURNING id INTO v_id;
  INSERT INTO applications.events (application_id, action, actor, data)
  VALUES (v_id, 'submitted', 'applicant', jsonb_build_object('kind', p->>'kind'));
  RETURN jsonb_build_object('id', v_id, 'duplicate', false);
END $$;--> statement-breakpoint
CREATE FUNCTION applications.set_status(p_id uuid, p_status text, p_actor text, p_detail text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_from text;
BEGIN
  IF p_actor IS NULL OR p_actor !~ '^staff:' THEN RAISE EXCEPTION 'applications.set_status: a staff actor is required'; END IF;
  IF p_status NOT IN ('in_review', 'rejected', 'needs_info') THEN RAISE EXCEPTION 'applications.set_status: use approve for approvals, and only these statuses'; END IF;
  SELECT status INTO v_from FROM applications.applications WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'applications.set_status: unknown application'; END IF;
  IF NOT ((v_from IN ('new', 'needs_info') AND v_from <> p_status)
       OR (v_from = 'in_review' AND p_status IN ('rejected', 'needs_info'))
       OR (v_from = 'rejected' AND p_status = 'in_review')) THEN
    RAISE EXCEPTION 'applications.set_status: % cannot become %', v_from, p_status;
  END IF;
  UPDATE applications.applications SET status = p_status, updated_at = now(),
    decided_by = CASE WHEN p_status = 'rejected' THEN p_actor ELSE decided_by END,
    decided_at = CASE WHEN p_status = 'rejected' THEN now() ELSE decided_at END
   WHERE id = p_id;
  INSERT INTO applications.events (application_id, action, actor, data)
  VALUES (p_id, 'status_changed', p_actor, jsonb_build_object('from', v_from, 'to', p_status, 'detail', left(coalesce(p_detail, ''), 500)));
  RETURN p_status;
END $$;--> statement-breakpoint
CREATE FUNCTION applications.assign(p_id uuid, p_assignee text, p_actor text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF p_actor IS NULL OR p_actor !~ '^staff:' THEN RAISE EXCEPTION 'applications.assign: a staff actor is required'; END IF;
  IF p_assignee IS NOT NULL AND p_assignee !~ '^staff:' THEN RAISE EXCEPTION 'applications.assign: assign to a staff member'; END IF;
  UPDATE applications.applications SET assigned_to = p_assignee, updated_at = now() WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'applications.assign: unknown application'; END IF;
  INSERT INTO applications.events (application_id, action, actor, data)
  VALUES (p_id, 'assigned', p_actor, jsonb_build_object('assignee', p_assignee));
END $$;--> statement-breakpoint
CREATE FUNCTION applications.add_note(p_id uuid, p_body text, p_actor text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_id uuid;
BEGIN
  IF p_actor IS NULL OR p_actor !~ '^staff:' THEN RAISE EXCEPTION 'applications.add_note: a staff actor is required'; END IF;
  INSERT INTO applications.notes (application_id, body, author) VALUES (p_id, p_body, p_actor) RETURNING id INTO v_id;
  INSERT INTO applications.events (application_id, action, actor, data) VALUES (p_id, 'note_added', p_actor, '{}'::jsonb);
  RETURN v_id;
END $$;--> statement-breakpoint
CREATE FUNCTION applications.log_email(p_id uuid, p_kind text, p_subject text, p_actor text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF p_actor IS NULL OR (p_actor !~ '^staff:' AND p_actor <> 'applicant') THEN RAISE EXCEPTION 'applications.log_email: a staff actor is required'; END IF;
  INSERT INTO applications.events (application_id, action, actor, data)
  VALUES (p_id, 'email_sent', p_actor, jsonb_build_object('kind', p_kind, 'subject', left(p_subject, 200)));
END $$;--> statement-breakpoint
-- Approve: one signup code (one use) tied to the applicant's email and the approved plan, created in
-- the same statement as the status change. The console makes and mails the code; only its hash is stored.
CREATE FUNCTION applications.approve(p_id uuid, p_hash text, p_plan text, p_expires timestamptz, p_actor text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_status text; v_email text; v_org text; v_code uuid;
BEGIN
  IF p_actor IS NULL OR p_actor !~ '^staff:' THEN RAISE EXCEPTION 'applications.approve: a staff actor is required'; END IF;
  SELECT status, contact_email, org_name INTO v_status, v_email, v_org FROM applications.applications WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'applications.approve: unknown application'; END IF;
  IF v_status NOT IN ('new', 'in_review', 'needs_info') THEN RAISE EXCEPTION 'applications.approve: % cannot be approved', v_status; END IF;
  IF NOT EXISTS (SELECT 1 FROM billing.plans WHERE key = p_plan) THEN RAISE EXCEPTION 'applications.approve: unknown plan'; END IF;
  INSERT INTO platform.signup_codes (code_hash, max_uses, expires_at, note, created_by, bound_email, plan_key, application_id)
  VALUES (p_hash, 1, p_expires, left('application: ' || v_org, 200), p_actor, v_email, p_plan, p_id)
  RETURNING id INTO v_code;
  UPDATE applications.applications SET status = 'approved', approved_plan = p_plan, signup_code_id = v_code,
    decided_by = p_actor, decided_at = now(), updated_at = now() WHERE id = p_id;
  INSERT INTO applications.events (application_id, action, actor, data)
  VALUES (p_id, 'approved', p_actor, jsonb_build_object('plan', p_plan, 'signupCodeId', v_code, 'expiresAt', p_expires));
  RETURN v_code;
END $$;--> statement-breakpoint
-- Resend an invitation: the old code is revoked and a new one takes its place (before the applicant has signed up).
CREATE FUNCTION applications.reissue(p_id uuid, p_hash text, p_expires timestamptz, p_actor text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_old uuid; v_plan text; v_email text; v_org text; v_uses integer; v_new uuid;
BEGIN
  IF p_actor IS NULL OR p_actor !~ '^staff:' THEN RAISE EXCEPTION 'applications.reissue: a staff actor is required'; END IF;
  SELECT a.signup_code_id, a.approved_plan, a.contact_email, a.org_name INTO v_old, v_plan, v_email, v_org
    FROM applications.applications a WHERE a.id = p_id AND a.status = 'approved' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'applications.reissue: not an approved application'; END IF;
  SELECT uses INTO v_uses FROM platform.signup_codes WHERE id = v_old;
  IF v_uses > 0 THEN RAISE EXCEPTION 'applications.reissue: this invitation was already used'; END IF;
  UPDATE platform.signup_codes SET revoked_at = coalesce(revoked_at, now()), revoked_by = coalesce(revoked_by, p_actor) WHERE id = v_old;
  INSERT INTO platform.signup_codes (code_hash, max_uses, expires_at, note, created_by, bound_email, plan_key, application_id)
  VALUES (p_hash, 1, p_expires, left('application: ' || v_org, 200), p_actor, v_email, v_plan, p_id) RETURNING id INTO v_new;
  UPDATE applications.applications SET signup_code_id = v_new, updated_at = now() WHERE id = p_id;
  INSERT INTO applications.events (application_id, action, actor, data)
  VALUES (p_id, 'invitation_reissued', p_actor, jsonb_build_object('signupCodeId', v_new, 'expiresAt', p_expires));
  RETURN v_new;
END $$;--> statement-breakpoint
-- Signup codes tied to an email: the old one-argument claim refuses them, so a bound code can only
-- be used through claim_signup_code_for with the signed-in person's verified email.
CREATE OR REPLACE FUNCTION platform.claim_signup_code(p_hash text)
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
  WITH claimed AS (
    UPDATE platform.signup_codes c SET uses = c.uses + 1
    WHERE c.code_hash = p_hash AND c.revoked_at IS NULL AND c.expires_at > now() AND c.uses < c.max_uses
      AND c.bound_email IS NULL
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM claimed)
$$;--> statement-breakpoint
CREATE FUNCTION platform.claim_signup_code_for(p_hash text, p_email text)
RETURNS TABLE (claim_ok boolean, claim_plan text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_plan text; v_app uuid;
BEGIN
  UPDATE platform.signup_codes c SET uses = c.uses + 1
   WHERE c.code_hash = p_hash AND c.revoked_at IS NULL AND c.expires_at > now() AND c.uses < c.max_uses
     AND (c.bound_email IS NULL OR c.bound_email = lower(p_email))
  RETURNING c.plan_key, c.application_id INTO v_plan, v_app;
  IF NOT FOUND THEN
    claim_ok := false; claim_plan := NULL; RETURN NEXT; RETURN;
  END IF;
  IF v_app IS NOT NULL THEN
    INSERT INTO applications.events (application_id, action, actor, data) VALUES (v_app, 'signed_up', 'applicant', '{}'::jsonb);
  END IF;
  claim_ok := true; claim_plan := v_plan; RETURN NEXT; RETURN;
END $$;--> statement-breakpoint
-- What the signup page may show about a code the visitor holds: that it works, the email it is for and its plan.
CREATE FUNCTION platform.signup_code_info(p_hash text)
RETURNS TABLE (info_valid boolean, info_email text, info_plan text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT true, c.bound_email, c.plan_key FROM platform.signup_codes c
   WHERE c.code_hash = p_hash AND c.revoked_at IS NULL AND c.expires_at > now() AND c.uses < c.max_uses
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION applications.submit(jsonb) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION applications.set_status(uuid, text, text, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION applications.assign(uuid, text, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION applications.add_note(uuid, text, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION applications.log_email(uuid, text, text, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION applications.approve(uuid, text, text, timestamptz, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION applications.reissue(uuid, text, timestamptz, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.claim_signup_code_for(text, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.signup_code_info(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION applications.submit(jsonb) TO app_user;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION applications.log_email(uuid, text, text, text) TO app_user;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform.claim_signup_code_for(text, text) TO app_user;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform.signup_code_info(text) TO app_user;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION applications.set_status(uuid, text, text, text) TO platform_reader;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION applications.assign(uuid, text, text) TO platform_reader;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION applications.add_note(uuid, text, text) TO platform_reader;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION applications.log_email(uuid, text, text, text) TO platform_reader;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION applications.approve(uuid, text, text, timestamptz, text) TO platform_reader;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION applications.reissue(uuid, text, timestamptz, text) TO platform_reader;
-- hand-written: end
