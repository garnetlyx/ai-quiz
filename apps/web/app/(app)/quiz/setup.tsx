import { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  Switch,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuizStore } from "@/stores/quiz";
import { useTopicStore } from "@/stores/topic";
import { api } from "@/services/api";
import type { MaterialQuestionBankItem } from "@ai-quiz/shared";

const USABLE_STATUSES = new Set(["ready", "auto_repaired"]);

export default function QuizSetupScreen() {
  const { topicId, mode, subtopics } = useLocalSearchParams<{ topicId: string; mode?: string; subtopics?: string }>();
  const router = useRouter();
  const [questionCount, setQuestionCount] = useState("10");
  const [timerEnabled, setTimerEnabled] = useState(false);
  const [timerMinutes, setTimerMinutes] = useState("30");
  const [isLoading, setIsLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string> | null>(null); // null = all (not yet loaded)
  const startQuiz = useQuizStore((s) => s.startQuiz);
  const startRetry = useQuizStore((s) => s.startRetry);
  const currentTopic = useTopicStore((s) => s.currentTopic);
  const fetchTopic = useTopicStore((s) => s.fetchTopic);
  const [usableByItem, setUsableByItem] = useState<Record<string, number> | null>(null);

  const parsedSubtopics = (() => {
    if (!subtopics) return undefined;
    try {
      const parsed = JSON.parse(decodeURIComponent(subtopics));
      return Array.isArray(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  })();

  useEffect(() => {
    if (topicId) fetchTopic(topicId);
  }, [topicId, fetchTopic]);

  useEffect(() => {
    if (!topicId || mode === "retry") return;
    api
      .request<MaterialQuestionBankItem[]>(`/api/topics/${topicId}/material-questions`)
      .then((rows) => {
        const counts: Record<string, number> = {};
        for (const row of rows) {
          if (!row.active || !row.scopeItemId || !USABLE_STATUSES.has(row.reviewStatus)) continue;
          counts[row.scopeItemId] = (counts[row.scopeItemId] || 0) + 1;
        }
        setUsableByItem(counts);
      })
      .catch(() => setUsableByItem({}));
  }, [topicId, mode]);

  const scopeChapters = useMemo(
    () => currentTopic?.scope.chapters ?? [],
    [currentTopic]
  );

  useEffect(() => {
    if (selected === null && scopeChapters.length > 0 && usableByItem !== null) {
      // Default: every unit that actually has usable questions.
      setSelected(
        new Set(
          scopeChapters
            .flatMap((chapter) => chapter.items)
            .filter((item) => (usableByItem[item.id] || 0) > 0)
            .map((item) => item.id)
        )
      );
    }
  }, [scopeChapters, usableByItem, selected]);

  const toggleItem = (itemId: string) => {
    setSelected((prev) => {
      if (!prev) return prev;
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const toggleChapter = (itemIds: string[]) => {
    setSelected((prev) => {
      if (!prev) return prev;
      const allSelected = itemIds.every((id) => prev.has(id));
      const next = new Set(prev);
      for (const id of itemIds) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const handleStart = async () => {
    setIsLoading(true);
    try {
      if (mode === "retry") {
        await startRetry(topicId);
      } else {
        const allIds = scopeChapters.flatMap((chapter) => chapter.items.map((item) => item.id));
        // Only filter when the selection is a strict subset - an unfiltered
        // quiz lets the API's own scope planning drive stratification.
        const isPartial =
          selected !== null &&
          (selected.size !== allIds.length || allIds.some((id) => !selected.has(id)));
        await startQuiz(topicId, parseInt(questionCount, 10), {
          timerEnabled,
          timerDuration: timerEnabled ? parseInt(timerMinutes, 10) * 60 : undefined,
          mode: mode === "subtopic" ? "subtopic" : undefined,
          subtopicFilter:
            mode === "subtopic" && parsedSubtopics
              ? parsedSubtopics
              : isPartial && selected
                ? [...selected]
                : undefined,
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

  const scopeReady = mode === "retry" || (currentTopic !== null && selected !== null);
  const totalUsable = useMemo(
    () => Object.values(usableByItem || {}).reduce((sum, n) => sum + n, 0),
    [usableByItem]
  );
  const selectedUsable = useMemo(() => {
    if (!selected || !usableByItem) return null;
    let sum = 0;
    for (const id of selected) sum += usableByItem[id] || 0;
    return sum;
  }, [selected, usableByItem]);

  const renderCheckbox = (checked: boolean, indeterminate = false) => (
    <View
      style={[
        styles.checkbox,
        (checked || indeterminate) && styles.checkboxChecked,
      ]}
    >
      {indeterminate ? (
        <View style={styles.checkboxDash} />
      ) : checked ? (
        <Text style={styles.checkboxMark}>✓</Text>
      ) : null}
    </View>
  );

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
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

            {mode !== "subtopic" && (
              <>
                <Text style={styles.label}>Topics</Text>
                {scopeReady ? (
                  <View style={styles.scopeBox}>
                    {scopeChapters.map((chapter) => {
                      const items = chapter.items;
                      const withQuestions = items.filter((item) => (usableByItem?.[item.id] || 0) > 0);
                      const selectableIds = withQuestions.map((item) => item.id);
                      const selectedCount = selectableIds.filter((id) => selected?.has(id)).length;
                      const allSelected = selectableIds.length > 0 && selectedCount === selectableIds.length;
                      const someSelected = selectedCount > 0 && !allSelected;
                      const chapterUsable = selectableIds.reduce((sum, id) => sum + (usableByItem?.[id] || 0), 0);
                      return (
                        <View key={chapter.id} style={styles.scopeChapter}>
                          <Pressable
                            style={styles.scopeChapterHeader}
                            onPress={() => toggleChapter(selectableIds)}
                            accessibilityRole="button"
                            accessibilityLabel={`Toggle all of ${chapter.title}`}
                          >
                            {renderCheckbox(allSelected, someSelected)}
                            <View style={styles.scopeChapterText}>
                              <Text style={styles.scopeChapterTitle}>{chapter.title}</Text>
                              <Text style={styles.scopeCount}>
                                {selectedCount}/{selectableIds.length} units · {chapterUsable} questions
                              </Text>
                            </View>
                          </Pressable>
                          {items.map((item) => {
                            const count = usableByItem?.[item.id] || 0;
                            const isSelected = selected?.has(item.id) ?? false;
                            return (
                              <Pressable
                                key={item.id}
                                style={styles.scopeItem}
                                onPress={() => count > 0 && toggleItem(item.id)}
                                accessibilityRole="button"
                                accessibilityLabel={`Toggle ${item.title}`}
                              >
                                {renderCheckbox(isSelected && count > 0)}
                                <Text style={[styles.scopeItemTitle, count === 0 && styles.scopeItemDisabled]}>
                                  {item.title}
                                </Text>
                                <Text style={styles.scopeCount}>{count > 0 ? count : "—"}</Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      );
                    })}
                    {selectedUsable !== null && (
                      <Text style={styles.scopeTotal}>
                        {selectedUsable} of {totalUsable} questions in scope
                      </Text>
                    )}
                  </View>
                ) : (
                  <ActivityIndicator style={styles.scopeLoading} />
                )}
              </>
            )}

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
          style={[styles.button, isLoading && styles.buttonDisabled, (mode !== "retry" && selected !== null && selected.size === 0) && styles.buttonDisabled]}
          onPress={handleStart}
          disabled={isLoading || (mode !== "retry" && selected !== null && selected.size === 0)}
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Start Quiz</Text>
          )}
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: "#f5f5f5" },
  container: { justifyContent: "center", padding: 16 },
  card: { backgroundColor: "#fff", padding: 24, borderRadius: 12, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 8, elevation: 4 },
  title: { fontSize: 22, fontWeight: "700", marginBottom: 20, textAlign: "center" },
  label: { fontSize: 14, fontWeight: "500", marginBottom: 8, color: "#333" },
  input: { borderWidth: 1, borderColor: "#ddd", borderRadius: 8, padding: 12, fontSize: 16, color: "#333", marginBottom: 16 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  button: { backgroundColor: "#2563eb", padding: 14, borderRadius: 8, alignItems: "center", marginTop: 8 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  scopeBox: { borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, padding: 8, marginBottom: 16 },
  scopeLoading: { marginVertical: 16 },
  scopeChapter: { marginBottom: 8 },
  scopeChapterHeader: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingHorizontal: 4 },
  scopeChapterText: { flex: 1 },
  scopeChapterTitle: { fontSize: 15, fontWeight: "700", color: "#1f2937" },
  scopeItem: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7, paddingLeft: 18 },
  scopeItemTitle: { flex: 1, fontSize: 14, color: "#374151" },
  scopeItemDisabled: { color: "#c0c4cc" },
  scopeCount: { fontSize: 12, color: "#9ca3af" },
  scopeTotal: { fontSize: 13, color: "#6b7280", textAlign: "center", marginTop: 4, marginBottom: 4 },
  checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: "#cbd5e1", alignItems: "center", justifyContent: "center", backgroundColor: "#fff" },
  checkboxChecked: { backgroundColor: "#2563eb", borderColor: "#2563eb" },
  checkboxMark: { color: "#fff", fontSize: 13, fontWeight: "700", lineHeight: 15 },
  checkboxDash: { width: 10, height: 2, backgroundColor: "#fff", borderRadius: 1 },
});
