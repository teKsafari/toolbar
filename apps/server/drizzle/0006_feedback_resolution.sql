CREATE TABLE "feedback_resolution" (
	"recording_id" uuid PRIMARY KEY NOT NULL,
	"resolved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_by" uuid,
	"resolved_by_name" text,
	"resolved_by_email" text,
	"note" text,
	"commit" text,
	"via" text
);
--> statement-breakpoint
ALTER TABLE "feedback_resolution" ADD CONSTRAINT "feedback_resolution_recording_id_recording_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."recording"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_resolution" ADD CONSTRAINT "feedback_resolution_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;