ALTER TABLE "project" ADD COLUMN "embed_key" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "embed_key_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_embed_key_unique" UNIQUE("embed_key");