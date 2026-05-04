// Auth Types

export interface User {
  id: string;
  email: string;
  createdAt: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  user: User;
  token: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
}

export interface RegisterResponse {
  user: User;
  token: string;
}

// Topic Types

export interface ExamFormat {
  choicesCount: number;
  isMultiSelect: boolean;
}

export interface Topic {
  id: string;
  userId: string;
  title: string;
  description: string;
  examFormat: ExamFormat | null;
  status: "draft" | "confirmed";
  createdAt: string;
}

export interface TopicCreateRequest {
  description: string;
}

export interface TopicCreateResponse {
  status: "needs_clarification" | "format_detected";
  clarification?: string;
  suggestedTopics?: string[];
  topic?: Topic;
  examFormat?: ExamFormat;
}

export interface FormatConfirmRequest {
  confirmed: boolean;
  feedback?: string;
}

export interface FormatConfirmResponse {
  topic: Topic;
  examFormat: ExamFormat;
}

// Quiz Types

export interface QuizSession {
  id: string;
  topicId: string;
  questionCount: number;
  timerEnabled: boolean;
  timerDurationSeconds: number | null;
  score: number | null;
  completedAt: string | null;
  mode: "normal" | "retry" | "subtopic";
  subtopicFilter: string[] | null;
  createdAt: string;
}

export interface QuizCreateRequest {
  questionCount: number;
  timerEnabled?: boolean;
  timerDuration?: number;
  mode?: "normal" | "retry" | "subtopic";
  subtopicFilter?: string[];
}

// Question Types

export interface QuestionOption {
  id: string;
  text: string;
}

export interface OptionExplanation {
  optionId: string;
  isCorrect: boolean;
  explanation: string;
}

export interface Question {
  id: string;
  sessionId: string;
  topicId: string;
  content: string;
  options: QuestionOption[];
  correctAnswers: number[];
  explanations: OptionExplanation[];
  subtopicTags: string[];
  userAnswers: number[] | null;
  isCorrect: boolean | null;
  isFlagged: boolean;
  flagReason: string | null;
}

/** Stripped view — correct answers hidden during active quiz */
export interface QuizQuestion {
  id: string;
  content: string;
  options: QuestionOption[];
  subtopicTags: string[];
  isFlagged: boolean;
}

export interface QuizSubmitRequest {
  answers: Record<string, number[]>;
}

export interface QuizSubmitResponse {
  session: QuizSession;
  questions: Question[];
  score: number;
  totalQuestions: number;
}

export interface FlagRequest {
  reason: string;
}

// History & Tracking Types

export interface MissedQuestion {
  id: string;
  content: string;
  options: QuestionOption[];
  correctAnswers: number[];
  explanations: OptionExplanation[];
  subtopicTags: string[];
  userAnswers: number[];
  sessionCreatedAt: string;
}

export interface WeakSubtopic {
  subtopic: string;
  missCount: number;
  totalQuestions: number;
  missRate: number;
}

export interface QuizHistoryEntry {
  sessionId: string;
  score: number;
  questionCount: number;
  completedAt: string;
  mode: "normal" | "retry" | "subtopic";
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

// API Types

export interface ApiError {
  message: string;
  statusCode: number;
}
