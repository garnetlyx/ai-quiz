CREATE TABLE "material_import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"file_path" text NOT NULL,
	"mime_type" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"error" text,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "material_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"content" text NOT NULL,
	"options" jsonb NOT NULL,
	"correct_answers" integer[] NOT NULL,
	"explanations" jsonb NOT NULL,
	"subtopic_tags" text[] DEFAULT '{}' NOT NULL,
	"scope_item_id" text,
	"source" text NOT NULL,
	"source_location" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"review_status" text DEFAULT 'needs_user_review' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_text_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"content" text NOT NULL,
	"labels" text[] DEFAULT '{}' NOT NULL,
	"source_location" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	"content" text NOT NULL,
	"options" jsonb NOT NULL,
	"correct_answers" integer[] NOT NULL,
	"explanations" jsonb NOT NULL,
	"subtopic_tags" text[] DEFAULT '{}' NOT NULL,
	"scope_item_id" text,
	"material_question_id" uuid,
	"user_answers" integer[],
	"is_correct" boolean,
	"is_flagged" boolean DEFAULT false NOT NULL,
	"flag_reason" text,
	"content_hash" text NOT NULL,
	"position" serial NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic_id" uuid NOT NULL,
	"question_count" integer NOT NULL,
	"timer_enabled" boolean DEFAULT false NOT NULL,
	"timer_duration_seconds" integer,
	"score" integer,
	"completed_at" timestamp with time zone,
	"mode" text DEFAULT 'normal' NOT NULL,
	"subtopic_filter" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topic_update_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"scope" jsonb DEFAULT '{"chapters":[]}'::jsonb NOT NULL,
	"materials" jsonb DEFAULT '{"examples":"","additionalTopics":"","notes":""}'::jsonb NOT NULL,
	"exam_format" jsonb,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "material_import_jobs" ADD CONSTRAINT "material_import_jobs_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_import_jobs" ADD CONSTRAINT "material_import_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_questions" ADD CONSTRAINT "material_questions_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_questions" ADD CONSTRAINT "material_questions_job_id_material_import_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."material_import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_text_chunks" ADD CONSTRAINT "material_text_chunks_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_text_chunks" ADD CONSTRAINT "material_text_chunks_job_id_material_import_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."material_import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_session_id_quiz_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."quiz_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_material_question_id_material_questions_id_fk" FOREIGN KEY ("material_question_id") REFERENCES "public"."material_questions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_sessions" ADD CONSTRAINT "quiz_sessions_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_update_suggestions" ADD CONSTRAINT "topic_update_suggestions_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_update_suggestions" ADD CONSTRAINT "topic_update_suggestions_job_id_material_import_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."material_import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "material_import_jobs_topic_id_idx" ON "material_import_jobs" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "material_import_jobs_user_id_idx" ON "material_import_jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "material_questions_topic_id_idx" ON "material_questions" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "material_questions_job_id_idx" ON "material_questions" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "material_questions_content_hash_idx" ON "material_questions" USING btree ("content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "material_questions_topic_hash_idx" ON "material_questions" USING btree ("topic_id","content_hash");--> statement-breakpoint
CREATE INDEX "material_text_chunks_topic_id_idx" ON "material_text_chunks" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "material_text_chunks_job_id_idx" ON "material_text_chunks" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "questions_content_hash_idx" ON "questions" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "questions_topic_id_idx" ON "questions" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "questions_session_id_idx" ON "questions" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "questions_material_question_id_idx" ON "questions" USING btree ("material_question_id");--> statement-breakpoint
CREATE INDEX "quiz_sessions_topic_id_idx" ON "quiz_sessions" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "topic_update_suggestions_topic_id_idx" ON "topic_update_suggestions" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "topic_update_suggestions_job_id_idx" ON "topic_update_suggestions" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "topics_user_id_idx" ON "topics" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");
