import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  serial,
  real,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("users_email_idx").on(table.email)]
);

export const usersRelations = relations(users, ({ many }) => ({
  topics: many(topics),
}));

export const topics = pgTable(
  "topics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull(),
    scope: jsonb("scope").notNull().default({ chapters: [] }),
    materials: jsonb("materials").notNull().default({
      examples: "",
      additionalTopics: "",
      notes: "",
      instructions: "",
    }),
    examFormat: jsonb("exam_format"),
    status: text("status", {
      enum: ["draft", "confirmed"],
    })
      .notNull()
      .default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [index("topics_user_id_idx").on(table.userId)]
);

export const topicsRelations = relations(topics, ({ one, many }) => ({
  user: one(users, {
    fields: [topics.userId],
    references: [users.id],
  }),
  sessions: many(quizSessions),
  materialImportJobs: many(materialImportJobs),
  materialQuestions: many(materialQuestions),
  materialTextChunks: many(materialTextChunks),
}));

export const materialImportJobs = pgTable(
  "material_import_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    topicId: uuid("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    filePath: text("file_path").notNull(),
    mimeType: text("mime_type").notNull(),
    status: text("status", {
      enum: ["queued", "processing", "completed", "failed"],
    }).notNull().default("queued"),
    progress: integer("progress").notNull().default(0),
    error: text("error"),
    summary: jsonb("summary").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("material_import_jobs_topic_id_idx").on(table.topicId),
    index("material_import_jobs_user_id_idx").on(table.userId),
  ]
);

export const materialImportJobsRelations = relations(materialImportJobs, ({ one, many }) => ({
  topic: one(topics, {
    fields: [materialImportJobs.topicId],
    references: [topics.id],
  }),
  user: one(users, {
    fields: [materialImportJobs.userId],
    references: [users.id],
  }),
  questions: many(materialQuestions),
  chunks: many(materialTextChunks),
}));

export const materialQuestions = pgTable(
  "material_questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    topicId: uuid("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => materialImportJobs.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    options: jsonb("options").notNull(),
    correctAnswers: integer("correct_answers").array().notNull(),
    explanations: jsonb("explanations").notNull(),
    subtopicTags: text("subtopic_tags").array().notNull().default([]),
    scopeItemId: text("scope_item_id"),
    source: text("source").notNull(),
    sourceLocation: jsonb("source_location").notNull().default({}),
    confidence: real("confidence").notNull().default(0),
    reviewStatus: text("review_status", {
      enum: ["ready", "auto_repaired", "needs_repair", "needs_user_review", "unresolved"],
    }).notNull().default("needs_user_review"),
    repairFlags: text("repair_flags").array().notNull().default([]),
    repairActions: jsonb("repair_actions").notNull().default([]),
    rawCandidate: jsonb("raw_candidate").notNull().default({}),
    active: boolean("active").notNull().default(true),
    contentHash: text("content_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("material_questions_topic_id_idx").on(table.topicId),
    index("material_questions_job_id_idx").on(table.jobId),
    index("material_questions_content_hash_idx").on(table.contentHash),
    uniqueIndex("material_questions_topic_hash_idx").on(table.topicId, table.contentHash),
  ]
);

export const materialQuestionsRelations = relations(materialQuestions, ({ one }) => ({
  topic: one(topics, {
    fields: [materialQuestions.topicId],
    references: [topics.id],
  }),
  job: one(materialImportJobs, {
    fields: [materialQuestions.jobId],
    references: [materialImportJobs.id],
  }),
}));

export const materialTextChunks = pgTable(
  "material_text_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    topicId: uuid("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => materialImportJobs.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: ["structure", "context", "definition"],
    }).notNull(),
    content: text("content").notNull(),
    labels: text("labels").array().notNull().default([]),
    sourceLocation: jsonb("source_location").notNull().default({}),
    confidence: real("confidence").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("material_text_chunks_topic_id_idx").on(table.topicId),
    index("material_text_chunks_job_id_idx").on(table.jobId),
  ]
);

export const materialTextChunksRelations = relations(materialTextChunks, ({ one }) => ({
  topic: one(topics, {
    fields: [materialTextChunks.topicId],
    references: [topics.id],
  }),
  job: one(materialImportJobs, {
    fields: [materialTextChunks.jobId],
    references: [materialImportJobs.id],
  }),
}));

export const topicUpdateSuggestions = pgTable(
  "topic_update_suggestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    topicId: uuid("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => materialImportJobs.id, { onDelete: "cascade" }),
    type: text("type", {
      enum: ["scope", "definition"],
    }).notNull(),
    status: text("status", {
      enum: ["pending", "approved", "rejected"],
    }).notNull().default("pending"),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("topic_update_suggestions_topic_id_idx").on(table.topicId),
    index("topic_update_suggestions_job_id_idx").on(table.jobId),
  ]
);

export const quizSessions = pgTable(
  "quiz_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    topicId: uuid("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    questionCount: integer("question_count").notNull(),
    timerEnabled: boolean("timer_enabled").notNull().default(false),
    timerDurationSeconds: integer("timer_duration_seconds"),
    score: integer("score"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    mode: text("mode", {
      enum: ["normal", "retry", "subtopic"],
    })
      .notNull()
      .default("normal"),
    subtopicFilter: text("subtopic_filter").array(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("quiz_sessions_topic_id_idx").on(table.topicId)]
);

export const quizSessionsRelations = relations(quizSessions, ({ one, many }) => ({
  topic: one(topics, {
    fields: [quizSessions.topicId],
    references: [topics.id],
  }),
  questions: many(questions),
}));

export const questions = pgTable(
  "questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => quizSessions.id, { onDelete: "cascade" }),
    topicId: uuid("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    options: jsonb("options").notNull(),
    correctAnswers: integer("correct_answers").array().notNull(),
    explanations: jsonb("explanations").notNull(),
    subtopicTags: text("subtopic_tags").array().notNull().default([]),
    scopeItemId: text("scope_item_id"),
    materialQuestionId: uuid("material_question_id").references(() => materialQuestions.id, {
      onDelete: "set null",
    }),
    userAnswers: integer("user_answers").array(),
    isCorrect: boolean("is_correct"),
    isFlagged: boolean("is_flagged").notNull().default(false),
    flagReason: text("flag_reason"),
    flagCategory: text("flag_category"),
    flagStatus: text("flag_status", {
      enum: ["pending_review", "upheld", "corrected", "verification_failed"],
    }),
    flagVerificationResult: jsonb("flag_verification_result"),
    flagVerifiedAt: timestamp("flag_verified_at", { withTimezone: true }),
    contentHash: text("content_hash").notNull(),
    position: serial("position"),
  },
  (table) => [
    index("questions_content_hash_idx").on(table.contentHash),
    index("questions_topic_id_idx").on(table.topicId),
    index("questions_session_id_idx").on(table.sessionId),
    index("questions_material_question_id_idx").on(table.materialQuestionId),
  ]
);

export const questionsRelations = relations(questions, ({ one }) => ({
  session: one(quizSessions, {
    fields: [questions.sessionId],
    references: [quizSessions.id],
  }),
  topic: one(topics, {
    fields: [questions.topicId],
    references: [topics.id],
  }),
}));
