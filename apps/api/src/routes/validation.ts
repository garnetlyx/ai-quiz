import { z } from "zod";

export const topicIdParamsSchema = z.object({
  topicId: z.string().uuid("Invalid topic ID format"),
});

export const idParamsSchema = z.object({
  id: z.string().uuid("Invalid ID format"),
});

export const sessionIdParamsSchema = z.object({
  sessionId: z.string().uuid("Invalid session ID format"),
});

export const topicAndJobIdParamsSchema = z.object({
  topicId: z.string().uuid("Invalid topic ID format"),
  jobId: z.string().uuid("Invalid job ID format"),
});

export const topicAndQuestionIdParamsSchema = z.object({
  topicId: z.string().uuid("Invalid topic ID format"),
  questionId: z.string().uuid("Invalid question ID format"),
});

export const sessionAndQuestionIdParamsSchema = z.object({
  sessionId: z.string().uuid("Invalid session ID format"),
  questionId: z.string().uuid("Invalid question ID format"),
});

export const topicAndSuggestionIdParamsSchema = z.object({
  topicId: z.string().uuid("Invalid topic ID format"),
  suggestionId: z.string().uuid("Invalid suggestion ID format"),
});

export const idAndJobIdParamsSchema = z.object({
  id: z.string().uuid("Invalid ID format"),
  jobId: z.string().uuid("Invalid job ID format"),
});

export const idAndQuestionIdParamsSchema = z.object({
  id: z.string().uuid("Invalid ID format"),
  questionId: z.string().uuid("Invalid question ID format"),
});

export const idAndSuggestionIdParamsSchema = z.object({
  id: z.string().uuid("Invalid ID format"),
  suggestionId: z.string().uuid("Invalid suggestion ID format"),
});
