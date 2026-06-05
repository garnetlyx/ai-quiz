import { create } from "zustand";
import { api } from "../services/api";
import type { QuizQuestion, Question } from "@ai-quiz/shared";

interface QuizState {
  sessionId: string | null;
  questions: QuizQuestion[];
  currentIndex: number;
  answers: Record<string, number[]>;
  isLoading: boolean;
  isSubmitting: boolean;
  timerEnabled: boolean;
  timerDurationSeconds: number | null;
  totalCount: number;
  pendingCount: number;
  isGenerating: boolean;

  startQuiz: (
    topicId: string,
    questionCount: number,
    options?: {
      timerEnabled?: boolean;
      timerDuration?: number;
      mode?: string;
      subtopicFilter?: string[];
    }
  ) => Promise<void>;
  startRetry: (topicId: string) => Promise<void>;
  pollQuestions: () => Promise<void>;
  selectAnswer: (questionId: string, answerIndex: number) => void;
  nextQuestion: () => void;
  prevQuestion: () => void;
  submitQuiz: () => Promise<{
    session: { id: string; score: number };
    questions: Question[];
    score: number;
    totalQuestions: number;
  }>;
  reset: () => void;
}

export const useQuizStore = create<QuizState>((set, get) => ({
  sessionId: null,
  questions: [],
  currentIndex: 0,
  answers: {},
  isLoading: false,
  isSubmitting: false,
  timerEnabled: false,
  timerDurationSeconds: null,
  totalCount: 0,
  pendingCount: 0,
  isGenerating: false,

  startQuiz: async (topicId, questionCount, options) => {
    set({ isLoading: true });
    const res = await api.request<{
      session: { id: string; timerEnabled?: boolean; timerDurationSeconds?: number | null; questionCount: number };
      questions: QuizQuestion[];
      pendingCount: number;
      isMultiSelect?: boolean;
    }>(`/api/topics/${topicId}/quiz`, {
      method: "POST",
      body: { questionCount, ...options },
    });

    const pendingCount = res.pendingCount || 0;
    set({
      sessionId: res.session.id,
      questions: res.questions,
      currentIndex: 0,
      answers: {},
      isLoading: false,
      timerEnabled: options?.timerEnabled ?? false,
      timerDurationSeconds: options?.timerDuration ?? null,
      totalCount: res.session.questionCount,
      pendingCount,
      isGenerating: pendingCount > 0,
    });
  },

  pollQuestions: async () => {
    const { sessionId, questions } = get();
    if (!sessionId) return;

    const res = await api.request<{
      currentCount: number;
      totalCount: number;
      isComplete: boolean;
      questions: QuizQuestion[];
    }>(`/api/quiz/${sessionId}/status`);

    const existingIds = new Set(questions.map((q) => q.id));
    const newQuestions = res.questions.filter((q) => !existingIds.has(q.id));

    if (newQuestions.length > 0) {
      set((state) => ({
        questions: [...state.questions, ...newQuestions],
        pendingCount: Math.max(0, res.totalCount - res.currentCount),
      }));
    }

    if (res.isComplete) {
      set({
        isGenerating: false,
        pendingCount: 0,
        totalCount: res.totalCount,
        questions: res.questions,
      });
    }
  },

  startRetry: async (topicId) => {
    set({ isLoading: true });
    const res = await api.request<{
      session: { id: string };
      questions: QuizQuestion[];
    }>(`/api/topics/${topicId}/quiz/retry`, {
      method: "POST",
    });
    set({
      sessionId: res.session.id,
      questions: res.questions,
      currentIndex: 0,
      answers: {},
      isLoading: false,
    });
  },

  selectAnswer: (questionId, answerIndex) => {
    const { questions, answers } = get();
    const question = questions.find((q) => q.id === questionId);
    if (!question) return;

    const current = answers[questionId] || [];
    const nextAnswer = question.isMultiSelect
      ? current.includes(answerIndex)
        ? current.filter((i) => i !== answerIndex)
        : [...current, answerIndex]
      : current.includes(answerIndex)
        ? current
        : [answerIndex];

    set({
      answers: {
        ...answers,
        [questionId]: nextAnswer,
      },
    });
  },

  nextQuestion: () => set((s) => ({ currentIndex: s.currentIndex + 1 })),
  prevQuestion: () => set((s) => ({ currentIndex: Math.max(0, s.currentIndex - 1) })),

  submitQuiz: async () => {
    const { sessionId, answers } = get();
    if (!sessionId) throw new Error("No active quiz");

    set({ isSubmitting: true });
    const res = await api.request<{
      session: { id: string; score: number };
      questions: Question[];
      score: number;
      totalQuestions: number;
    }>(`/api/quiz/${sessionId}/submit`, {
      method: "POST",
      body: { answers },
    });
    set({ isSubmitting: false });
    return res;
  },

  reset: () =>
    set({
      sessionId: null,
      questions: [],
      currentIndex: 0,
      answers: {},
      isLoading: false,
      isSubmitting: false,
      timerEnabled: false,
      timerDurationSeconds: null,
      totalCount: 0,
      pendingCount: 0,
      isGenerating: false,
    }),
}));
