ALTER TABLE "material_questions" ADD COLUMN "repair_flags" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "material_questions" ADD COLUMN "repair_actions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "material_questions" ADD COLUMN "raw_candidate" jsonb DEFAULT '{}'::jsonb NOT NULL;