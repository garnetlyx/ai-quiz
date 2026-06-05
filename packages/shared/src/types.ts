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

export interface TopicScopeItem {
  id: string;
  title: string;
  details: string;
  frozen: boolean;
}

export interface TopicScopeChapter {
  id: string;
  title: string;
  items: TopicScopeItem[];
}

export interface TopicMaterials {
  examples: string;
  additionalTopics: string;
  notes: string;
  instructions: string;
}

export interface TopicScope {
  chapters: TopicScopeChapter[];
}

export interface Topic {
  id: string;
  userId: string;
  title: string;
  description: string;
  scope: TopicScope;
  materials: TopicMaterials;
  examFormat: ExamFormat | null;
  status: "draft" | "confirmed";
  createdAt: string;
  archivedAt: string | null;
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

export interface TopicUpdateRequest {
  description: string;
  scope: TopicScope;
  materials: TopicMaterials;
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

export type FlagStatus = "pending_review" | "upheld" | "corrected" | "verification_failed";

export interface FlagVerificationResult {
  verdict: "upheld" | "corrected";
  reasoning: string;
  correctedAnswers?: number[];
  correctedExplanations?: OptionExplanation[];
  sources: Array<{ url: string; title: string; snippet: string }>;
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
  flagCategory: string | null;
  flagStatus: FlagStatus | null;
  flagVerificationResult: FlagVerificationResult | null;
  materialQuestionId: string | null;
}

/** Stripped view — correct answers hidden during active quiz */
export interface QuizQuestion {
  id: string;
  content: string;
  options: QuestionOption[];
  subtopicTags: string[];
  scopeItemId: string | null;
  isMultiSelect: boolean;
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
  category?: "wrong_answer" | "misleading_explanation" | "question_unclear";
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

// Material Import Types

export type MaterialImportStatus = "queued" | "processing" | "completed" | "failed";
export type MaterialChunkKind = "structure" | "context" | "definition";
export type MaterialReviewStatus = "ready" | "auto_repaired" | "needs_repair" | "needs_user_review" | "unresolved";
export type MaterialQuestionSource = "example_question" | "chapter_question" | "exam_question";
export type MaterialRepairFlag =
  | "missing_or_extra_options"
  | "merged_numbered_question"
  | "prompt_contains_options"
  | "option_swallowed_text"
  | "too_short_prompt"
  | "explicit_ocr_layout_pollution"
  | "answer_label_not_in_options"
  | "no_answer_label";
export type TopicSuggestionType = "scope" | "definition";
export type TopicSuggestionStatus = "pending" | "approved" | "rejected";

export interface MaterialRepairAction {
  type: string;
  status: "pending" | "applied" | "failed" | "not_attempted";
  note: string;
}

export interface MaterialRawCandidate {
  question: string;
  options: QuestionOption[];
  answerLabels: ("A" | "B" | "C" | "D")[];
}

export interface MaterialSourceLocation {
  filePath: string;
  lineStart: number;
  lineEnd: number;
  sectionTitle: string | null;
}

export interface MaterialImportSummary {
  questionCount: number;
  readyCount: number;
  autoRepairedCount: number;
  needsRepairCount: number;
  needsUserReviewCount: number;
  unresolvedCount: number;
  manualReviewRate: number;
  repairDebtRate: number;
  contextCount: number;
  structureCount: number;
  definitionCount: number;
  duplicateCount: number;
  aiVerifiedCount: number;
  aiFailedVerificationCount: number;
  webValidatedCount: number;
  unmatchedAnswerCount: number;
}

export interface MaterialImportJob {
  id: string;
  topicId: string;
  fileName: string;
  mimeType: string;
  status: MaterialImportStatus;
  progress: number;
  error: string | null;
  summary: Partial<MaterialImportSummary>;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface MaterialQuestionBankItem {
  id: string;
  topicId: string;
  content: string;
  options: QuestionOption[];
  correctAnswers: number[];
  explanations: OptionExplanation[];
  subtopicTags: string[];
  scopeItemId: string | null;
  source: MaterialQuestionSource;
  sourceLocation: Partial<MaterialSourceLocation>;
  confidence: number;
  reviewStatus: MaterialReviewStatus;
  repairFlags: MaterialRepairFlag[];
  repairActions: MaterialRepairAction[];
  rawCandidate: Partial<MaterialRawCandidate>;
  active: boolean;
  createdAt: string;
}

export interface MaterialTextChunk {
  id: string;
  topicId: string;
  kind: MaterialChunkKind;
  content: string;
  labels: string[];
  confidence: number;
  active: boolean;
  createdAt: string;
}

export interface TopicUpdateSuggestion {
  id: string;
  topicId: string;
  type: TopicSuggestionType;
  status: TopicSuggestionStatus;
  payload: unknown;
  createdAt: string;
}

export interface MaterialImportCreateResponse {
  jobs: MaterialImportJob[];
}

export interface MaterialQuestionUpdateRequest {
  reviewStatus?: MaterialReviewStatus;
  content?: string;
  options?: QuestionOption[];
  correctAnswers?: number[];
  active?: boolean;
  convertToContentKind?: MaterialChunkKind;
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
