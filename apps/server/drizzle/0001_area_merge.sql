CREATE TABLE "workspace_invite_link" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"token_enc" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_invite_link_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"target_label" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capture_notice" (
	"recording_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_sent_at" timestamp with time zone,
	"deleted_sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_name" text,
	"last_name" text,
	"role_hint" text,
	"image_asset_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capture_view" (
	"recording_id" uuid NOT NULL,
	"viewer" text NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "capture_view_recording_id_viewer_pk" PRIMARY KEY("recording_id","viewer")
);
--> statement-breakpoint
CREATE TABLE "comment_attachment" (
	"comment_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "comment_attachment_comment_id_asset_id_pk" PRIMARY KEY("comment_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "comment_reaction" (
	"comment_id" uuid NOT NULL,
	"actor" text NOT NULL,
	"key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comment_reaction_comment_id_actor_key_pk" PRIMARY KEY("comment_id","actor","key")
);
--> statement-breakpoint
CREATE TABLE "linked_issue" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"recording_id" uuid NOT NULL,
	"integration_id" uuid,
	"type" text NOT NULL,
	"url" text NOT NULL,
	"key" text NOT NULL,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_delivery" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"webhook_id" uuid NOT NULL,
	"event" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"response_status" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "folder_access" (
	"folder_id" uuid PRIMARY KEY NOT NULL,
	"private" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "folder_member" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"folder_id" uuid NOT NULL,
	"user_id" uuid,
	"email" text,
	"role" text DEFAULT 'viewer' NOT NULL,
	"invited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_auth_code" (
	"code_hash" "bytea" PRIMARY KEY NOT NULL,
	"grant_id" uuid NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_client" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"redirect_uris" jsonb NOT NULL,
	"client_uri" text,
	"logo_uri" text,
	"token_endpoint_auth_method" text DEFAULT 'none' NOT NULL,
	"secret_hash" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_grant" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"client_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"scopes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mcp_token" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"grant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_token_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "api_token" ADD COLUMN "prefix" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "api_token" ADD COLUMN "scopes" text[] DEFAULT '{cli:read,cli:write,mcp:read,mcp:write}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "api_token" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "comment" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "comment" ADD COLUMN "resolved_by" uuid;--> statement-breakpoint
ALTER TABLE "comment" ADD COLUMN "anon_key" text;--> statement-breakpoint
ALTER TABLE "folder" ADD COLUMN "short_id" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "recording" ADD COLUMN "access" text DEFAULT 'anyone' NOT NULL;--> statement-breakpoint
ALTER TABLE "recording" ADD COLUMN "private" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "recording" ADD COLUMN "source" text DEFAULT 'extension' NOT NULL;--> statement-breakpoint
ALTER TABLE "recording" ADD COLUMN "trim" jsonb;--> statement-breakpoint
ALTER TABLE "recording" ADD COLUMN "video_offset_ms" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "recording" ADD COLUMN "video_width" integer;--> statement-breakpoint
ALTER TABLE "recording" ADD COLUMN "video_height" integer;--> statement-breakpoint
ALTER TABLE "recording" ADD COLUMN "event_index" jsonb;--> statement-breakpoint
ALTER TABLE "recording" ADD COLUMN "renditions" jsonb;--> statement-breakpoint
ALTER TABLE "recording" ADD COLUMN "chapters" jsonb;--> statement-breakpoint
ALTER TABLE "recording" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "recording" ADD COLUMN "processing_progress" real;--> statement-breakpoint
ALTER TABLE "recording" ADD COLUMN "processing_error" text;--> statement-breakpoint
ALTER TABLE "recording" ADD COLUMN "finalized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "recording_link" ADD COLUMN "ref_url" text;--> statement-breakpoint
ALTER TABLE "share_link" ADD COLUMN "devtools" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "active_workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "workspace_invite_link" ADD CONSTRAINT "workspace_invite_link_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invite_link" ADD CONSTRAINT "workspace_invite_link_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_view" ADD CONSTRAINT "capture_view_recording_id_recording_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."recording"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_view" ADD CONSTRAINT "capture_view_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_attachment" ADD CONSTRAINT "comment_attachment_comment_id_comment_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_attachment" ADD CONSTRAINT "comment_attachment_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reaction" ADD CONSTRAINT "comment_reaction_comment_id_comment_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linked_issue" ADD CONSTRAINT "linked_issue_integration_id_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integration"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_webhook_id_webhook_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhook"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder_access" ADD CONSTRAINT "folder_access_folder_id_folder_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folder"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder_member" ADD CONSTRAINT "folder_member_folder_id_folder_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folder"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder_member" ADD CONSTRAINT "folder_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder_member" ADD CONSTRAINT "folder_member_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_auth_code" ADD CONSTRAINT "mcp_auth_code_grant_id_mcp_grant_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."mcp_grant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_grant" ADD CONSTRAINT "mcp_grant_client_id_mcp_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."mcp_client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_grant" ADD CONSTRAINT "mcp_grant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_grant" ADD CONSTRAINT "mcp_grant_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_token" ADD CONSTRAINT "mcp_token_grant_id_mcp_grant_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."mcp_grant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_org_idx" ON "audit_log" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "capture_view_user_idx" ON "capture_view" USING btree ("user_id","last_at");--> statement-breakpoint
CREATE INDEX "linked_issue_recording_idx" ON "linked_issue" USING btree ("recording_id");--> statement-breakpoint
CREATE UNIQUE INDEX "linked_issue_uq" ON "linked_issue" USING btree ("recording_id","url");--> statement-breakpoint
CREATE INDEX "webhook_delivery_hook_idx" ON "webhook_delivery" USING btree ("webhook_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "folder_member_user_uq" ON "folder_member" USING btree ("folder_id","user_id");--> statement-breakpoint
CREATE INDEX "folder_member_email_idx" ON "folder_member" USING btree ("email");--> statement-breakpoint
CREATE INDEX "mcp_grant_user_idx" ON "mcp_grant" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mcp_token_grant_idx" ON "mcp_token" USING btree ("grant_id");--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "folder_short_id_uq" ON "folder" USING btree ("short_id");