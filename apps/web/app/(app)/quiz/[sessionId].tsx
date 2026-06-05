import { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  TextInput,
  Modal,
  ActivityIndicator,
  StyleSheet,
  Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuizStore } from "@/stores/quiz";
import { api } from "@/services/api";
import type { QuizQuestion } from "@ai-quiz/shared";

type FlagCategory = "wrong_answer" | "misleading_explanation" | "question_unclear";

const FLAG_CATEGORIES: { value: FlagCategory; label: string }[] = [
  { value: "wrong_answer", label: "Wrong answer" },
  { value: "misleading_explanation", label: "Misleading explanation" },
  { value: "question_unclear", label: "Question unclear" },
];

export default function QuizFlowScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();
  const questions = useQuizStore((s) => s.questions);
  const currentIndex = useQuizStore((s) => s.currentIndex);
  const answers = useQuizStore((s) => s.answers);
  const selectAnswer = useQuizStore((s) => s.selectAnswer);
  const nextQuestion = useQuizStore((s) => s.nextQuestion);
  const prevQuestion = useQuizStore((s) => s.prevQuestion);
  const submitQuiz = useQuizStore((s) => s.submitQuiz);
  const isSubmitting = useQuizStore((s) => s.isSubmitting);
  const timerEnabled = useQuizStore((s) => s.timerEnabled);
  const timerDurationSeconds = useQuizStore((s) => s.timerDurationSeconds);
  const totalCount = useQuizStore((s) => s.totalCount);
  const pendingCount = useQuizStore((s) => s.pendingCount);
  const isGenerating = useQuizStore((s) => s.isGenerating);
  const pollQuestions = useQuizStore((s) => s.pollQuestions);

  const [flagModalVisible, setFlagModalVisible] = useState(false);
  const [flagReason, setFlagReason] = useState("");
  const [flagCategory, setFlagCategory] = useState<FlagCategory>("wrong_answer");
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const currentQuestion = questions[currentIndex];
  const isLastQuestion = currentIndex === questions.length - 1;
  const isFirstQuestion = currentIndex === 0;
  const selectedAnswers = currentQuestion ? answers[currentQuestion.id] || [] : [];

  useEffect(() => {
    if (questions.length > 0 || !sessionId) return;

    const hydrate = async () => {
      try {
        const res = await api.request<{
          currentCount: number;
          totalCount: number;
          isComplete: boolean;
          questions: QuizQuestion[];
        }>(`/api/quiz/${sessionId}/status`);

        useQuizStore.setState({
          sessionId,
          questions: res.questions,
          totalCount: res.totalCount,
          pendingCount: Math.max(0, res.totalCount - res.currentCount),
          isGenerating: !res.isComplete,
          isLoading: false,
        });
      } catch {
        router.replace("/(app)/dashboard");
      }
    };
    hydrate();
  }, [sessionId, questions.length, router]);

  // Poll for new AI-generated questions
  useEffect(() => {
    if (!isGenerating || !sessionId) return;

    pollRef.current = setInterval(() => {
      pollQuestions();
    }, 3000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [isGenerating, sessionId, pollQuestions]);

  useEffect(() => {
    if (timerEnabled && timerDurationSeconds && timerDurationSeconds > 0) {
      setTimeLeft(timerDurationSeconds);
      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => (prev !== null ? prev - 1 : null));
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [timerEnabled, timerDurationSeconds]);

  useEffect(() => {
    if (timeLeft !== null && timeLeft <= 0 && timerRef.current) {
      clearInterval(timerRef.current);
      handleSubmit();
    }
  }, [timeLeft]);

  const handleSubmit = useCallback(async () => {
    try {
      const result = await submitQuiz();
      router.replace(`/(app)/results/${result.session.id}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to submit");
    }
  }, [submitQuiz, router]);

  const handleFlag = async () => {
    if (!currentQuestion || !sessionId) return;
    try {
      await api.request(`/api/quiz/${sessionId}/questions/${currentQuestion.id}/flag`, {
        method: "POST",
        body: { reason: flagReason, category: flagCategory },
      });
      setFlagModalVisible(false);
      setFlagReason("");
      setFlagCategory("wrong_answer");
    } catch {
      alert("Failed to flag question");
    }
  };

  if (!currentQuestion) {
    if (isGenerating || (questions.length === 0 && totalCount > 0)) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#2563eb" />
          <Text style={styles.generatingTitle}>Generating questions...</Text>
          <Text style={styles.generatingSub}>
            {pendingCount > 0 ? `${pendingCount} question${pendingCount !== 1 ? "s" : ""} remaining` : "Almost done"}
          </Text>
        </View>
      );
    }
    if (questions.length === 0 && !isGenerating) {
      return (
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>No questions available</Text>
          <Text style={styles.errorSub}>
            {totalCount === 0
              ? "Question generation failed. Please try again."
              : "Still loading..."}
          </Text>
          <Pressable style={styles.errorButton} onPress={() => router.replace("/(app)/dashboard")}>
            <Text style={styles.errorButtonText}>Back to Dashboard</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text style={styles.loadingText}>Loading questions...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {timeLeft !== null && (
        <View style={styles.timerBar}>
          <Text style={styles.timerText}>
            {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, "0")}
          </Text>
        </View>
      )}

      <View style={styles.progressContainer}>
        <Text style={styles.progressText}>
          {currentIndex + 1} of {totalCount > questions.length ? totalCount : questions.length}
        </Text>
        <View style={styles.progressBar}>
          <View
            style={[
              styles.progressFill,
              { width: `${((currentIndex + 1) / (totalCount || questions.length)) * 100}%` },
            ]}
          />
        </View>
        {isGenerating && (
          <View style={styles.generatingRow}>
            <ActivityIndicator size="small" color="#2563eb" />
            <Text style={styles.generatingText}>
              Generating {pendingCount} more question{pendingCount !== 1 ? "s" : ""}...
            </Text>
          </View>
        )}
      </View>

      <View style={styles.questionCard}>
        <View style={styles.tagsRow}>
          {currentQuestion.subtopicTags.map((tag) => (
            <View key={tag} style={styles.tag}>
              <Text style={styles.tagText}>{tag}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.questionText}>{currentQuestion.content}</Text>
        <Text style={styles.answerMode}>
          {currentQuestion.isMultiSelect ? "Select all that apply" : "Select one answer"}
        </Text>

        {currentQuestion.options.map((option, idx) => (
          <Pressable
            key={option.id}
            style={[styles.optionButton, selectedAnswers.includes(idx) && styles.optionSelected]}
            onPress={() => selectAnswer(currentQuestion.id, idx)}
          >
            <Text style={[styles.optionText, selectedAnswers.includes(idx) && styles.optionTextSelected]}>
              {option.id}. {option.text}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.footer}>
        <Pressable onPress={() => setFlagModalVisible(true)} style={styles.flagButton}>
          <Text style={styles.flagText}>⚠ Flag</Text>
        </Pressable>

        <Pressable
          style={[styles.previousButton, isFirstQuestion && styles.buttonDisabled]}
          onPress={prevQuestion}
          disabled={isFirstQuestion}
        >
          <Text style={styles.previousButtonText}>Previous</Text>
        </Pressable>

        {isLastQuestion && !isGenerating ? (
          <Pressable
            style={[styles.submitButton, isSubmitting && styles.buttonDisabled]}
            onPress={handleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitButtonText}>Submit Quiz</Text>
            )}
          </Pressable>
        ) : isLastQuestion && isGenerating ? (
          <View style={styles.waitingButton}>
            <ActivityIndicator size="small" color="#2563eb" />
            <Text style={styles.waitingText}>Waiting for questions...</Text>
          </View>
        ) : (
          <Pressable style={styles.nextButton} onPress={nextQuestion}>
            <Text style={styles.nextButtonText}>Next →</Text>
          </Pressable>
        )}
      </View>

      <Modal visible={flagModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Flag Question</Text>

            <Text style={styles.categoryLabel}>Category</Text>
            {FLAG_CATEGORIES.map((cat) => (
              <Pressable
                key={cat.value}
                style={[styles.categoryOption, flagCategory === cat.value && styles.categoryOptionSelected]}
                onPress={() => setFlagCategory(cat.value)}
              >
                <View style={styles.radioOuter}>
                  {flagCategory === cat.value && <View style={styles.radioInner} />}
                </View>
                <Text style={[styles.categoryText, flagCategory === cat.value && styles.categoryTextSelected]}>
                  {cat.label}
                </Text>
              </Pressable>
            ))}

            <TextInput
              style={styles.modalInput}
              placeholder="Why is this question problematic?"
              value={flagReason}
              onChangeText={setFlagReason}
              multiline
              placeholderTextColor="#999"
            />

            {currentQuestion && (
              <Pressable
                style={styles.googleSearchButton}
                onPress={() => {
                  if (Platform.OS === "web") {
                    window.open(`https://www.google.com/search?q=${encodeURIComponent(currentQuestion.content)}`, "_blank");
                  }
                }}
              >
                <Text style={styles.googleSearchButtonText}>Search this question on Google</Text>
              </Pressable>
            )}

            <View style={styles.modalButtons}>
              <Pressable style={styles.modalCancel} onPress={() => { setFlagModalVisible(false); setFlagReason(""); setFlagCategory("wrong_answer"); }}>
                <Text>Cancel</Text>
              </Pressable>
              <Pressable style={styles.modalSubmit} onPress={handleFlag}>
                <Text style={styles.modalSubmitText}>Flag</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  loadingText: { marginTop: 12, color: "#666", fontSize: 14 },
  generatingTitle: { marginTop: 16, color: "#2563eb", fontSize: 18, fontWeight: "600" },
  generatingSub: { marginTop: 8, color: "#666", fontSize: 14 },
  errorTitle: { fontSize: 18, fontWeight: "600", color: "#dc2626", marginBottom: 8 },
  errorSub: { fontSize: 14, color: "#666", marginBottom: 24 },
  errorButton: { backgroundColor: "#2563eb", paddingVertical: 12, paddingHorizontal: 24, borderRadius: 8 },
  errorButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  timerBar: { backgroundColor: "#dc2626", padding: 8, alignItems: "center" },
  timerText: { color: "#fff", fontSize: 18, fontWeight: "700" },
  progressContainer: { padding: 16, backgroundColor: "#fff" },
  progressText: { fontSize: 14, color: "#666", marginBottom: 8 },
  progressBar: { height: 4, backgroundColor: "#e5e7eb", borderRadius: 2 },
  progressFill: { height: 4, backgroundColor: "#2563eb", borderRadius: 2 },
  generatingRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  generatingText: { fontSize: 12, color: "#2563eb" },
  questionCard: { backgroundColor: "#fff", margin: 16, padding: 20, borderRadius: 12, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  tagsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 },
  tag: { backgroundColor: "#eff6ff", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 },
  tagText: { fontSize: 12, color: "#2563eb" },
  questionText: { fontSize: 18, fontWeight: "500", marginBottom: 16, lineHeight: 26 },
  answerMode: { fontSize: 13, color: "#666", marginBottom: 10 },
  optionButton: { borderWidth: 1, borderColor: "#ddd", borderRadius: 8, padding: 14, marginBottom: 8 },
  optionSelected: { borderColor: "#2563eb", backgroundColor: "#eff6ff" },
  optionText: { fontSize: 16, color: "#333" },
  optionTextSelected: { color: "#2563eb", fontWeight: "600" },
  footer: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#eee" },
  flagButton: { padding: 8 },
  flagText: { color: "#f59e0b", fontSize: 14 },
  submitButton: { backgroundColor: "#16a34a", paddingVertical: 12, paddingHorizontal: 24, borderRadius: 8 },
  submitButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  previousButton: { borderWidth: 1, borderColor: "#2563eb", paddingVertical: 12, paddingHorizontal: 16, borderRadius: 8 },
  previousButtonText: { color: "#2563eb", fontSize: 16, fontWeight: "600" },
  nextButton: { backgroundColor: "#2563eb", paddingVertical: 12, paddingHorizontal: 24, borderRadius: 8 },
  nextButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  buttonDisabled: { opacity: 0.6 },
  waitingButton: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#eff6ff", paddingVertical: 12, paddingHorizontal: 20, borderRadius: 8 },
  waitingText: { color: "#2563eb", fontSize: 14, fontWeight: "500" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: 16 },
  modalContent: { backgroundColor: "#fff", padding: 24, borderRadius: 12 },
  modalTitle: { fontSize: 18, fontWeight: "600", marginBottom: 12 },
  modalInput: { borderWidth: 1, borderColor: "#ddd", borderRadius: 8, padding: 12, minHeight: 80, marginBottom: 16, textAlignVertical: "top" },
  modalButtons: { flexDirection: "row", justifyContent: "flex-end", gap: 12 },
  modalCancel: { padding: 10 },
  modalSubmit: { backgroundColor: "#f59e0b", padding: 10, borderRadius: 6 },
  modalSubmitText: { color: "#fff", fontWeight: "600" },
  categoryLabel: { fontSize: 14, fontWeight: "600", color: "#333", marginBottom: 8 },
  categoryOption: { flexDirection: "row", alignItems: "center", paddingVertical: 8, paddingHorizontal: 12, borderRadius: 6, marginBottom: 4, borderWidth: 1, borderColor: "#e5e7eb" },
  categoryOptionSelected: { borderColor: "#f59e0b", backgroundColor: "#fffbeb" },
  categoryText: { fontSize: 14, color: "#666", marginLeft: 8 },
  categoryTextSelected: { color: "#b45309", fontWeight: "600" },
  radioOuter: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: "#ccc", alignItems: "center", justifyContent: "center" },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#f59e0b" },
  googleSearchButton: { backgroundColor: "#f1f5f9", borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8, padding: 10, marginBottom: 16, alignItems: "center" },
  googleSearchButtonText: { color: "#475569", fontSize: 14, fontWeight: "500" },
});
