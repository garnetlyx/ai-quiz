import { useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api } from "@/services/api";
import type { Question, QuizSession } from "@ai-quiz/shared";

export default function ResultsScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();
  const [session, setSession] = useState<QuizSession | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [isLoading, setIsLoading] = useState(true);

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
              <Text style={[styles.resultBadge, item.isCorrect ? styles.badgeCorrect : styles.badgeWrong]}>
                {item.isCorrect ? "Correct" : "Incorrect"}
              </Text>
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
          </View>
        )}
      />
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
  questionNumber: { fontSize: 14, fontWeight: "600", color: "#666" },
  resultBadge: { fontSize: 12, fontWeight: "600", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  badgeCorrect: { backgroundColor: "#dcfce7", color: "#16a34a" },
  badgeWrong: { backgroundColor: "#fef2f2", color: "#dc2626" },
  questionText: { fontSize: 16, fontWeight: "500", marginBottom: 12, lineHeight: 24 },
  optionRow: { padding: 10, borderRadius: 6, marginBottom: 6, backgroundColor: "#f9fafb" },
  optionCorrect: { backgroundColor: "#dcfce7", borderLeftWidth: 3, borderLeftColor: "#16a34a" },
  optionWrong: { backgroundColor: "#fef2f2", borderLeftWidth: 3, borderLeftColor: "#dc2626" },
  optionLabel: { fontSize: 14, color: "#333" },
  explanation: { fontSize: 13, color: "#666", marginTop: 4, lineHeight: 18 },
  tagsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  tag: { backgroundColor: "#eff6ff", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 },
  tagText: { fontSize: 12, color: "#2563eb" },
});
