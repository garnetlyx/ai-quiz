import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  Switch,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuizStore } from "@/stores/quiz";

export default function QuizSetupScreen() {
  const { topicId, mode, subtopics } = useLocalSearchParams<{ topicId: string; mode?: string; subtopics?: string }>();
  const router = useRouter();
  const [questionCount, setQuestionCount] = useState("10");
  const [timerEnabled, setTimerEnabled] = useState(false);
  const [timerMinutes, setTimerMinutes] = useState("30");
  const [isLoading, setIsLoading] = useState(false);
  const startQuiz = useQuizStore((s) => s.startQuiz);
  const startRetry = useQuizStore((s) => s.startRetry);

  const parsedSubtopics = (() => {
    if (!subtopics) return undefined;
    try {
      const parsed = JSON.parse(decodeURIComponent(subtopics));
      return Array.isArray(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  })();

  const handleStart = async () => {
    setIsLoading(true);
    try {
      if (mode === "retry") {
        await startRetry(topicId);
      } else {
        await startQuiz(topicId, parseInt(questionCount, 10), {
          timerEnabled,
          timerDuration: timerEnabled ? parseInt(timerMinutes, 10) * 60 : undefined,
          mode: mode === "subtopic" ? "subtopic" : undefined,
          subtopicFilter: parsedSubtopics,
        });
      }
      const sessionId = useQuizStore.getState().sessionId;
      router.replace(`/(app)/quiz/${sessionId}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to start quiz");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>
          {mode === "retry" ? "Retry Missed Questions" : mode === "subtopic" ? "Subtopic Practice" : "Quiz Setup"}
        </Text>

        {mode !== "retry" && (
          <>
            <Text style={styles.label}>Number of questions</Text>
            <TextInput
              style={styles.input}
              value={questionCount}
              onChangeText={setQuestionCount}
              keyboardType="number-pad"
              placeholderTextColor="#999"
            />

            <View style={styles.row}>
              <Text style={styles.label}>Timer</Text>
              <Switch value={timerEnabled} onValueChange={setTimerEnabled} />
            </View>

            {timerEnabled && (
              <>
                <Text style={styles.label}>Duration (minutes)</Text>
                <TextInput
                  style={styles.input}
                  value={timerMinutes}
                  onChangeText={setTimerMinutes}
                  keyboardType="number-pad"
                  placeholderTextColor="#999"
                />
              </>
            )}
          </>
        )}

        <Pressable
          style={[styles.button, isLoading && styles.buttonDisabled]}
          onPress={handleStart}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Start Quiz</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5", justifyContent: "center", padding: 16 },
  card: { backgroundColor: "#fff", padding: 24, borderRadius: 12, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 8, elevation: 4 },
  title: { fontSize: 22, fontWeight: "700", marginBottom: 20, textAlign: "center" },
  label: { fontSize: 14, fontWeight: "500", marginBottom: 8, color: "#333" },
  input: { borderWidth: 1, borderColor: "#ddd", borderRadius: 8, padding: 12, fontSize: 16, color: "#333", marginBottom: 16 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  button: { backgroundColor: "#2563eb", padding: 14, borderRadius: 8, alignItems: "center", marginTop: 8 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
