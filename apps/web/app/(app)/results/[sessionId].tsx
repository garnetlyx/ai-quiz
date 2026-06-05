import { useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  ActivityIndicator,
  Modal,
  TextInput,
  StyleSheet,
  Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api } from "@/services/api";
import type { FlagStatus, Question, QuizSession } from "@ai-quiz/shared";

type FlagCategory = "wrong_answer" | "misleading_explanation" | "question_unclear";

const FLAG_CATEGORIES: { value: FlagCategory; label: string }[] = [
  { value: "wrong_answer", label: "Wrong answer" },
  { value: "misleading_explanation", label: "Misleading explanation" },
  { value: "question_unclear", label: "Question unclear" },
];

function FlagStatusBadge({ status }: { status: FlagStatus | null }) {
  if (!status) return null;
  const config: Record<FlagStatus, { label: string; style: any }> = {
    pending_review: { label: "🔍 Reviewing...", style: styles.badgePending },
    upheld: { label: "✓ Original upheld", style: styles.badgeUpheld },
    corrected: { label: "✏️ Answer corrected", style: styles.badgeCorrected },
    verification_failed: { label: "⚠ Check unavailable", style: styles.badgeVerificationFailed },
  };
  const { label, style } = config[status];
  return <Text style={[styles.flagStatusBadge, style]}>{label}</Text>;
}

export default function ResultsScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();
  const [session, setSession] = useState<QuizSession | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [flaggingQuestionId, setFlaggingQuestionId] = useState<string | null>(null);
  const [flagReason, setFlagReason] = useState("");
  const [flagCategory, setFlagCategory] = useState<FlagCategory>("wrong_answer");

  useEffect(() => {
    if (!sessionId) return;
    api.request<{ session: QuizSession; questions: Question[] }>(
      `/api/quiz/${sessionId}`
    )
      .then((res) => {
        setSession(res.session);
        setQuestions(res.questions);
      })
      .finally(() => setIsLoading(false));
  }, [sessionId]);

  const handleFlag = async () => {
    if (!sessionId || !flaggingQuestionId) return;
    const reason = flagReason || "Question or answer accuracy disputed from review";
    await api.request(`/api/quiz/${sessionId}/questions/${flaggingQuestionId}/flag`, {
      method: "POST",
      body: { reason, category: flagCategory },
    });
    setQuestions((current) =>
      current.map((question) =>
        question.id === flaggingQuestionId
          ? { ...question, isFlagged: true, flagReason: reason, flagCategory, flagStatus: "pending_review" as FlagStatus }
          : question
      )
    );
    setFlaggingQuestionId(null);
    setFlagReason("");
    setFlagCategory("wrong_answer");
  };

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!session) {
    return (
      <View style={styles.centered}>
        <Text>Results not available</Text>
      </View>
    );
  }

  const score = session.score ?? 0;
  const total = questions.length;
  const correct = questions.filter((q) => q.isCorrect).length;
  const scoreColor = score >= 70 ? "#16a34a" : score >= 50 ? "#f59e0b" : "#dc2626";

  return (
    <View style={styles.container}>
      <View style={styles.scoreCard}>
        <Text style={[styles.scoreValue, { color: scoreColor }]}>{score}%</Text>
        <Text style={styles.scoreDetail}>
          {correct}/{total} correct
        </Text>
      </View>

      <View style={styles.actions}>
        <Pressable
          style={styles.retryButton}
          onPress={() => router.back()}
        >
          <Text style={styles.retryButtonText}>Back to Topic</Text>
        </Pressable>
      </View>

      <FlatList
        data={questions}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item, index }) => (
          <View
            style={[
              styles.questionCard,
              !item.isCorrect && styles.questionCardMissed,
            ]}
          >
            <View style={styles.questionHeader}>
              <Text style={styles.questionNumber}>Q{index + 1}</Text>
              <View style={styles.headerActions}>
                <Text style={[styles.sourceBadge, item.materialQuestionId ? styles.badgeMaterial : styles.badgeAi]}>
                  {item.materialQuestionId ? "📚 Material Bank" : "🤖 AI Generated"}
                </Text>
                <Text style={[styles.resultBadge, item.isCorrect ? styles.badgeCorrect : styles.badgeWrong]}>
                  {item.isCorrect ? "Correct" : "Incorrect"}
                </Text>
                <Pressable
                  style={[styles.flagButton, item.isFlagged && styles.flaggedButton]}
                  onPress={() => setFlaggingQuestionId(item.id)}
                >
                  <Text style={styles.flagButtonText}>{item.isFlagged ? "Flagged" : "Flag"}</Text>
                  {item.isFlagged && <FlagStatusBadge status={item.flagStatus} />}
                </Pressable>
              </View>
            </View>

            <Text style={styles.questionText}>{item.content}</Text>

            {item.options.map((opt, optIdx) => {
              const isUserAnswer = item.userAnswers?.includes(optIdx);
              const isCorrectAnswer = item.correctAnswers.includes(optIdx);
              const explanation = item.explanations.find(
                (e) => e.optionId === opt.id
              );

              return (
                <View
                  key={opt.id}
                  style={[
                    styles.optionRow,
                    isCorrectAnswer && styles.optionCorrect,
                    isUserAnswer && !isCorrectAnswer && styles.optionWrong,
                  ]}
                >
                  <Text style={styles.optionLabel}>
                    {opt.id}. {opt.text}
                    {isUserAnswer ? " (your answer)" : ""}
                    {isCorrectAnswer ? " ✓" : ""}
                  </Text>
                  {explanation && (
                    <Text style={styles.explanation}>
                      {explanation.explanation}
                    </Text>
                  )}
                </View>
              );
            })}

            <View style={styles.tagsRow}>
              {item.subtopicTags.map((tag) => (
                <View key={tag} style={styles.tag}>
                  <Text style={styles.tagText}>{tag}</Text>
                </View>
              ))}
            </View>

            {(item.flagStatus === "upheld" || item.flagStatus === "corrected") && item.flagVerificationResult && (
              <View style={styles.verificationBox}>
                <Text style={styles.verificationTitle}>
                  {item.flagStatus === "corrected" ? "Answer Corrected" : "Original Upheld"}
                </Text>
                <Text style={styles.verificationReasoning}>{item.flagVerificationResult.reasoning}</Text>
                {item.flagStatus === "corrected" && item.flagVerificationResult.correctedAnswers && (
                  <Text style={styles.correctedAnswer}>
                    Correct answer: {item.flagVerificationResult.correctedAnswers.map((i) => item.options[i]?.id).filter(Boolean).join(", ")}
                  </Text>
                )}
              </View>
            )}
          </View>
        )}
      />

      <Modal visible={Boolean(flaggingQuestionId)} animationType="slide" transparent>
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
              value={flagReason}
              onChangeText={setFlagReason}
              placeholder="What looks wrong about the answer or explanation?"
              multiline
              placeholderTextColor="#999"
            />

            {flaggingQuestionId && (
              <Pressable
                style={styles.googleSearchButton}
                onPress={() => {
                  const q = questions.find((q) => q.id === flaggingQuestionId);
                  if (q && Platform.OS === "web") {
                    window.open(`https://www.google.com/search?q=${encodeURIComponent(q.content)}`, "_blank");
                  }
                }}
              >
                <Text style={styles.googleSearchButtonText}>Search this question on Google</Text>
              </Pressable>
            )}

            <View style={styles.modalButtons}>
              <Pressable onPress={() => { setFlaggingQuestionId(null); setFlagReason(""); setFlagCategory("wrong_answer"); }} style={styles.modalCancel}>
                <Text>Cancel</Text>
              </Pressable>
              <Pressable onPress={handleFlag} style={styles.modalSubmit}>
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
  scoreCard: { backgroundColor: "#fff", padding: 24, alignItems: "center", borderBottomWidth: 1, borderBottomColor: "#eee" },
  scoreValue: { fontSize: 48, fontWeight: "700" },
  scoreDetail: { fontSize: 16, color: "#666", marginTop: 4 },
  actions: { flexDirection: "row", justifyContent: "center", padding: 16, gap: 12 },
  retryButton: { backgroundColor: "#2563eb", paddingVertical: 12, paddingHorizontal: 24, borderRadius: 8 },
  retryButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  list: { padding: 16, paddingTop: 0 },
  questionCard: { backgroundColor: "#fff", padding: 16, borderRadius: 8, marginBottom: 12 },
  questionCardMissed: { borderLeftWidth: 4, borderLeftColor: "#dc2626" },
  questionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  questionNumber: { fontSize: 14, fontWeight: "600", color: "#666" },
  resultBadge: { fontSize: 12, fontWeight: "600", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  sourceBadge: { fontSize: 11, fontWeight: "500", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  badgeMaterial: { backgroundColor: "#eff6ff", color: "#2563eb" },
  badgeAi: { backgroundColor: "#faf5ff", color: "#7c3aed" },
  badgeCorrect: { backgroundColor: "#dcfce7", color: "#16a34a" },
  badgeWrong: { backgroundColor: "#fef2f2", color: "#dc2626" },
  flagButton: { borderWidth: 1, borderColor: "#f59e0b", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 },
  flaggedButton: { backgroundColor: "#fffbeb" },
  flagButtonText: { color: "#b45309", fontSize: 12, fontWeight: "600" },
  questionText: { fontSize: 16, fontWeight: "500", marginBottom: 12, lineHeight: 24 },
  optionRow: { padding: 10, borderRadius: 6, marginBottom: 6, backgroundColor: "#f9fafb" },
  optionCorrect: { backgroundColor: "#dcfce7", borderLeftWidth: 3, borderLeftColor: "#16a34a" },
  optionWrong: { backgroundColor: "#fef2f2", borderLeftWidth: 3, borderLeftColor: "#dc2626" },
  optionLabel: { fontSize: 14, color: "#333" },
  explanation: { fontSize: 13, color: "#666", marginTop: 4, lineHeight: 18 },
  tagsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  tag: { backgroundColor: "#eff6ff", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 },
  tagText: { fontSize: 12, color: "#2563eb" },
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
  flagStatusBadge: { fontSize: 10, fontWeight: "600", paddingHorizontal: 6, paddingVertical: 1, borderRadius: 3, marginLeft: 4 },
  badgePending: { backgroundColor: "#fef9c3", color: "#a16207" },
  badgeUpheld: { backgroundColor: "#dcfce7", color: "#16a34a" },
  badgeCorrected: { backgroundColor: "#fff7ed", color: "#ea580c" },
  badgeVerificationFailed: { backgroundColor: "#f3f4f6", color: "#6b7280" },
  verificationBox: { marginTop: 12, padding: 12, borderRadius: 8, backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0" },
  verificationTitle: { fontSize: 13, fontWeight: "600", color: "#475569", marginBottom: 4 },
  verificationReasoning: { fontSize: 13, color: "#64748b", lineHeight: 18 },
  correctedAnswer: { fontSize: 13, fontWeight: "600", color: "#ea580c", marginTop: 6 },
});
