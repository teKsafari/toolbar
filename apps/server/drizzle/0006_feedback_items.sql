CREATE TABLE "feedback_item" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"recording_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"n" integer NOT NULL,
	"kind" text NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"quote" text,
	"target" jsonb,
	"anchor" jsonb,
	"shapes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"crop_asset_id" uuid,
	"crop_rect" jsonb,
	"voice_asset_id" uuid,
	"voice_duration_ms" integer,
	"transcript_status" text,
	"transcript_vtt" text,
	"transcript_text" text,
	"transcript_language" text,
	"transcript_error" text,
	"context" jsonb,
	"page" jsonb NOT NULL,
	"intent" text DEFAULT 'fix' NOT NULL,
	"severity" text DEFAULT 'important' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"t" bigint NOT NULL,
	"author_user_id" uuid,
	"author_name" text,
	"author_email" text,
	"author_issuer" text,
	"author_subject" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feedback_item" ADD CONSTRAINT "feedback_item_recording_id_recording_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."recording"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_item" ADD CONSTRAINT "feedback_item_crop_asset_id_asset_id_fk" FOREIGN KEY ("crop_asset_id") REFERENCES "public"."asset"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_item" ADD CONSTRAINT "feedback_item_voice_asset_id_asset_id_fk" FOREIGN KEY ("voice_asset_id") REFERENCES "public"."asset"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_item" ADD CONSTRAINT "feedback_item_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_item_recording_idx" ON "feedback_item" USING btree ("recording_id","n");--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_item_client_idx" ON "feedback_item" USING btree ("recording_id","client_id");