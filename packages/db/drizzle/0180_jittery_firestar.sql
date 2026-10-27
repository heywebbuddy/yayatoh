CREATE TABLE "media"."program_documents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" text NOT NULL,
	"file_name" text NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"bytes" bigint NOT NULL,
	"created_by" uuid,
	CONSTRAINT "program_documents_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "program_documents_owner_type_check" CHECK (owner_type in ('sponsor', 'exhibitor')),
	CONSTRAINT "program_documents_title_check" CHECK (char_length(title) between 1 and 120),
	CONSTRAINT "program_documents_name_check" CHECK (char_length(file_name) between 1 and 200),
	CONSTRAINT "program_documents_key_check" CHECK (starts_with(storage_key, org_id::text || '/' || id::text || '/f-')),
	CONSTRAINT "program_documents_sha_check" CHECK (sha256 ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "program_documents_bytes_check" CHECK (bytes between 1 and 10485760)
);
--> statement-breakpoint
ALTER TABLE "media"."program_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "media"."program_documents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "program"."sponsor_team_members" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"sponsor_id" uuid NOT NULL,
	"name" text NOT NULL,
	"title" text,
	"account_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "sponsor_team_members_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "sponsor_team_members_name_check" CHECK (char_length(name) between 1 and 120),
	CONSTRAINT "sponsor_team_members_title_check" CHECK (title is null or char_length(title) <= 120)
);
--> statement-breakpoint
ALTER TABLE "program"."sponsor_team_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "program"."sponsor_team_members" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "program"."exhibitors" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "program"."exhibitors" ADD COLUMN "contact_phone" text;--> statement-breakpoint
ALTER TABLE "program"."exhibitors" ADD COLUMN "video_url" text;--> statement-breakpoint
ALTER TABLE "program"."sponsors" ADD COLUMN "long_description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "program"."sponsors" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "program"."sponsors" ADD COLUMN "contact_phone" text;--> statement-breakpoint
ALTER TABLE "program"."sponsors" ADD COLUMN "video_url" text;--> statement-breakpoint
ALTER TABLE "program"."sponsor_team_members" ADD CONSTRAINT "sponsor_team_members_sponsor_fk" FOREIGN KEY ("org_id","sponsor_id") REFERENCES "program"."sponsors"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "program_documents_org_id_idx" ON "media"."program_documents" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "program_documents_org_owner_idx" ON "media"."program_documents" USING btree ("org_id","owner_type","owner_id");--> statement-breakpoint
CREATE INDEX "sponsor_team_members_org_id_idx" ON "program"."sponsor_team_members" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "sponsor_team_members_org_sponsor_idx" ON "program"."sponsor_team_members" USING btree ("org_id","sponsor_id","position");--> statement-breakpoint
CREATE POLICY "program_documents_tenant_isolation" ON "media"."program_documents" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "sponsor_team_members_tenant_isolation" ON "program"."sponsor_team_members" AS PERMISSIVE FOR ALL TO "app_user" USING (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)) WITH CHECK (org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid));
--> statement-breakpoint
-- hand-written: begin (public brochures of sponsors and exhibitors; allowlisted columns, SECURITY DEFINER)
-- The attachments of one owner for its public page (`p_private_ok`: the server checked an access grant).
CREATE FUNCTION media.public_program_documents(p_org uuid, p_owner_type text, p_owner_id uuid, p_private_ok boolean)
RETURNS TABLE (id uuid, owner_id uuid, title text, file_name text, bytes bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT d.id, d.owner_id, d.title, d.file_name, d.bytes
  FROM media.program_documents d
  WHERE d.org_id = p_org AND d.owner_type = p_owner_type AND d.owner_id = p_owner_id
    AND media.owner_visibility(d.org_id, d.owner_type, d.owner_id) = ANY (
      CASE WHEN p_private_ok THEN ARRAY['public', 'private_event'] ELSE ARRAY['public'] END)
  ORDER BY d.created_at
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION media.public_program_documents(uuid, text, uuid, boolean) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION media.public_program_documents(uuid, text, uuid, boolean) TO app_user;--> statement-breakpoint
-- What a download request points at: the file and who may see it ('public', 'private_event', 'none').
CREATE FUNCTION media.program_document_target(p_org uuid, p_doc uuid)
RETURNS TABLE (file_name text, storage_key text, sha256 text, bytes bigint, visibility text, event_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT d.file_name, d.storage_key, d.sha256, d.bytes,
         media.owner_visibility(d.org_id, d.owner_type, d.owner_id),
         media.owner_event(d.org_id, d.owner_type, d.owner_id)
  FROM media.program_documents d
  WHERE d.org_id = p_org AND d.id = p_doc
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION media.program_document_target(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION media.program_document_target(uuid, uuid) TO app_user;
-- hand-written: end
