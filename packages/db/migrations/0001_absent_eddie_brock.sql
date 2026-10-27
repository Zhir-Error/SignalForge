CREATE TABLE "organization_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" varchar(320) NOT NULL,
	"role" varchar(20) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_invitations_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "organization_invitations_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "organization_invitations_role_check" CHECK ("organization_invitations"."role" in ('admin','member','viewer'))
);
--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_invitations_org_email_idx" ON "organization_invitations" USING btree ("organization_id","email");
--> statement-breakpoint
ALTER TABLE organization_invitations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE organization_invitations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY organization_invitations_tenant_policy ON organization_invitations
  USING (
    organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
    OR current_setting('app.invitation_lookup', true) = 'on'
  )
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
