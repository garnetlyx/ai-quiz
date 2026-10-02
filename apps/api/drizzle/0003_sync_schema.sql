ALTER TABLE "questions" ADD COLUMN "flag_category" text;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "flag_status" text;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "flag_verification_result" jsonb;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "flag_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ai_agent" text DEFAULT 'glm' NOT NULL;