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
}));

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
    userAnswers: integer("user_answers").array(),
    isCorrect: boolean("is_correct"),
    isFlagged: boolean("is_flagged").notNull().default(false),
    flagReason: text("flag_reason"),
    contentHash: text("content_hash").notNull(),
    position: serial("position"),
  },
  (table) => [
    index("questions_content_hash_idx").on(table.contentHash),
    index("questions_topic_id_idx").on(table.topicId),
    index("questions_session_id_idx").on(table.sessionId),
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
