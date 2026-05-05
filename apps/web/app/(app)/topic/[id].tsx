import { useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  FlatList,
  StyleSheet,
  TextInput,
  ScrollView,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTopicStore } from "@/stores/topic";
import { api } from "@/services/api";
import type { QuizHistoryEntry, WeakSubtopic } from "@ai-quiz/shared";
import { TopicEditor } from "@/components/TopicEditor";

export default function TopicDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const currentTopic = useTopicStore((s) => s.currentTopic);
  const fetchTopic = useTopicStore((s) => s.fetchTopic);
  const updateTopic = useTopicStore((s) => s.updateTopic);
  const confirmFormat = useTopicStore((s) => s.confirmFormat);
  const isLoading = useTopicStore((s) => s.isLoading);
  const [activeTab, setActiveTab] = useState<"quiz" | "scope" | "history" | "missed" | "subtopics">("quiz");
  const [history, setHistory] = useState<QuizHistoryEntry[]>([]);
  const [weakSubtopics, setWeakSubtopics] = useState<WeakSubtopic[]>([]);
  const [selectedSubtopics, setSelectedSubtopics] = useState<Set<string>>(new Set());
  const [missedCount, setMissedCount] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [setupError, setSetupError] = useState("");
  const [isConfirming, setIsConfirming] = useState(false);

  useEffect(() => {
    if (id) fetchTopic(id);
  }, [id, fetchTopic]);

  useEffect(() => {
    if (!id) return;
    if (activeTab === "history") {
      api.request<{ data: QuizHistoryEntry[] }>(`/api/topics/${id}/history`).then((r) => setHistory(r.data));
    }
    if (activeTab === "subtopics") {
      api.request<WeakSubtopic[]>(`/api/topics/${id}/weak-subtopics`).then(setWeakSubtopics);
    }
    if (activeTab === "missed") {
      api.request<unknown[]>(`/api/topics/${id}/missed`).then((r) => setMissedCount(r.length));
    }
  }, [id, activeTab]);

  if (isLoading || !currentTopic) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const scopeItems = currentTopic.scope.chapters.flatMap((chapter) => chapter.items);
  const activeScopeCount = scopeItems.filter((item) => !item.frozen).length;
  const frozenScopeCount = scopeItems.filter((item) => item.frozen).length;

  const handleConfirmFormat = async (confirmed: boolean) => {
    if (!id) return;
    setSetupError("");
    setIsConfirming(true);
    try {
      await confirmFormat(id, confirmed, confirmed ? undefined : feedback);
      if (confirmed) {
        setActiveTab("quiz");
      } else {
        setFeedback("");
      }
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : "Failed to update setup");
    } finally {
      setIsConfirming(false);
    }
  };

  if (currentTopic.status !== "confirmed") {
    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.setupContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.backLink}>← Back</Text>
          </Pressable>
          <Text style={styles.title}>{currentTopic.title}</Text>
          <Text style={styles.description}>{currentTopic.description}</Text>
          <Text style={styles.setupStatus}>Setup needed</Text>
        </View>

        <View style={styles.setupCard}>
          <Text style={styles.sectionTitle}>Review Exam Format</Text>
          {currentTopic.examFormat ? (
            <>
              <Text style={styles.format}>
                {currentTopic.examFormat.choicesCount} choices per question
              </Text>
              <Text style={styles.format}>
                {currentTopic.examFormat.isMultiSelect
                  ? "Multiple answers possible"
                  : "Single answer per question"}
              </Text>
            </>
          ) : (
            <Text style={styles.description}>No exam format has been detected yet.</Text>
          )}

          {setupError ? <Text style={styles.error}>{setupError}</Text> : null}

          <TopicEditor
            topic={currentTopic}
            saveLabel="Save Scope"
            onSave={async (data) => {
              if (!id) return;
              await updateTopic(id, data);
            }}
          />

          <View style={styles.rowButtons}>
            <Pressable
              style={[styles.actionButton, styles.confirmButton, isConfirming && styles.disabled]}
              disabled={isConfirming || !currentTopic.examFormat}
              onPress={() => handleConfirmFormat(true)}
            >
              <Text style={styles.actionButtonText}>
                {isConfirming ? "Saving..." : "Confirm Setup"}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.actionButton, styles.rejectButton, isConfirming && styles.disabled]}
              disabled={isConfirming}
              onPress={() => handleConfirmFormat(false)}
            >
              <Text style={styles.actionButtonText}>Wrong Format</Text>
            </Pressable>
          </View>

          <TextInput
            style={styles.input}
            placeholder="Describe what's wrong before choosing Wrong Format..."
            value={feedback}
            onChangeText={setFeedback}
            placeholderTextColor="#999"
          />
        </View>
      </ScrollView>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.backLink}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>{currentTopic.title}</Text>
        <Text style={styles.description}>{currentTopic.description}</Text>
        {currentTopic.examFormat && (
          <Text style={styles.format}>
            {currentTopic.examFormat.choicesCount} choices
            {currentTopic.examFormat.isMultiSelect ? " (multi-select)" : ""}
          </Text>
        )}
      </View>

      <View style={styles.tabs}>
        {(["quiz", "scope", "history", "missed", "subtopics"] as const).map((tab) => (
          <Pressable
            key={tab}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab === "quiz" ? "Start Quiz" : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </Text>
          </Pressable>
        ))}
      </View>

      {activeTab === "quiz" && (
        <View style={styles.tabContent}>
          <Text style={styles.scopeMeta}>
            {activeScopeCount} active topics
            {frozenScopeCount > 0 ? ` · ${frozenScopeCount} frozen` : ""}
          </Text>
          <Pressable
            style={styles.actionButton}
            onPress={() => router.push(`/(app)/quiz/setup?topicId=${id}`)}
          >
            <Text style={styles.actionButtonText}>Start New Quiz</Text>
          </Pressable>
        </View>
      )}

      {activeTab === "scope" && (
        <View style={styles.tabContent}>
          <TopicEditor
            topic={currentTopic}
            onSave={async (data) => {
              if (!id) return;
              await updateTopic(id, data);
            }}
          />
        </View>
      )}

      {activeTab === "history" && (
        <FlatList
          data={history}
          keyExtractor={(item) => item.sessionId}
          renderItem={({ item }) => (
            <Pressable
              style={styles.historyItem}
              onPress={() => router.push(`/(app)/results/${item.sessionId}`)}
            >
              <Text style={styles.historyScore}>Score: {item.score}%</Text>
              <Text style={styles.historyMeta}>
                {item.questionCount} questions · {item.mode}
              </Text>
              <Text style={styles.historyDate}>{item.completedAt}</Text>
            </Pressable>
          )}
          ListEmptyComponent={<Text style={styles.emptyText}>No quiz history yet</Text>}
          contentContainerStyle={styles.listContent}
        />
      )}

      {activeTab === "missed" && (
        <View style={styles.tabContent}>
          <Text style={styles.missedCount}>{missedCount} missed questions</Text>
          {missedCount > 0 && (
            <Pressable
              style={styles.actionButton}
              onPress={() => router.push(`/(app)/quiz/setup?topicId=${id}&mode=retry`)}
            >
              <Text style={styles.actionButtonText}>Retry Missed Questions</Text>
            </Pressable>
          )}
        </View>
      )}

      {activeTab === "subtopics" && (
        <View style={styles.tabContent}>
          {weakSubtopics.length > 0 && selectedSubtopics.size > 0 && (
            <Pressable
              style={styles.actionButton}
              onPress={() => router.push(
                `/(app)/quiz/setup?topicId=${id}&mode=subtopic&subtopics=${encodeURIComponent(JSON.stringify([...selectedSubtopics]))}`
              )}
            >
              <Text style={styles.actionButtonText}>
                Practice Selected ({selectedSubtopics.size})
              </Text>
            </Pressable>
          )}
          <FlatList
            data={weakSubtopics}
            keyExtractor={(item) => item.subtopic}
            renderItem={({ item }) => (
              <Pressable
                style={[
                  styles.subtopicItem,
                  selectedSubtopics.has(item.subtopic) && styles.subtopicItemSelected,
                ]}
                onPress={() => {
                  setSelectedSubtopics((prev) => {
                    const next = new Set(prev);
                    if (next.has(item.subtopic)) next.delete(item.subtopic);
                    else next.add(item.subtopic);
                    return next;
                  });
                }}
              >
                <Text style={styles.subtopicName}>{item.subtopic}</Text>
                <Text style={styles.subtopicRate}>
                  {item.missRate}% miss rate ({item.missCount}/{item.totalQuestions})
                </Text>
              </Pressable>
            )}
            ListEmptyComponent={<Text style={styles.emptyText}>No weak subtopics identified yet</Text>}
            contentContainerStyle={styles.listContent}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: { backgroundColor: "#fff", padding: 16, borderBottomWidth: 1, borderBottomColor: "#eee" },
  backLink: { color: "#2563eb", fontSize: 14, marginBottom: 8 },
  title: { fontSize: 24, fontWeight: "700" },
  description: { fontSize: 14, color: "#666", marginTop: 4 },
  format: { fontSize: 12, color: "#999", marginTop: 4 },
  setupStatus: { color: "#b45309", fontSize: 13, fontWeight: "600", marginTop: 8 },
  setupContent: { paddingBottom: 24 },
  setupCard: { backgroundColor: "#fff", margin: 16, padding: 16, borderRadius: 8, gap: 8 },
  sectionTitle: { fontSize: 16, fontWeight: "700", marginBottom: 4 },
  error: { color: "#dc2626", fontSize: 14 },
  input: { borderWidth: 1, borderColor: "#ddd", borderRadius: 8, padding: 12, fontSize: 14, color: "#333", marginTop: 4 },
  rowButtons: { flexDirection: "row", gap: 12, marginTop: 8 },
  confirmButton: { flex: 1, backgroundColor: "#16a34a" },
  rejectButton: { flex: 1, backgroundColor: "#dc2626" },
  disabled: { opacity: 0.6 },
  tabs: { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#eee" },
  tab: { flex: 1, paddingVertical: 12, alignItems: "center" },
  tabActive: { borderBottomWidth: 2, borderBottomColor: "#2563eb" },
  tabText: { fontSize: 14, color: "#666" },
  tabTextActive: { color: "#2563eb", fontWeight: "600" },
  tabContent: { padding: 16 },
  actionButton: { backgroundColor: "#2563eb", padding: 14, borderRadius: 8, alignItems: "center" },
  actionButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  historyItem: { backgroundColor: "#fff", padding: 16, borderRadius: 8, marginBottom: 8 },
  historyScore: { fontSize: 18, fontWeight: "600" },
  historyMeta: { fontSize: 14, color: "#666", marginTop: 4 },
  historyDate: { fontSize: 12, color: "#999", marginTop: 4 },
  missedCount: { fontSize: 16, marginBottom: 12 },
  scopeMeta: { fontSize: 14, color: "#666", marginBottom: 12 },
  subtopicItem: { backgroundColor: "#fff", padding: 16, borderRadius: 8, marginBottom: 8, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  subtopicItemSelected: { backgroundColor: "#eff6ff", borderWidth: 1, borderColor: "#2563eb" },
  subtopicName: { fontSize: 16, fontWeight: "500", flex: 1 },
  subtopicRate: { fontSize: 14, color: "#dc2626", fontWeight: "600" },
  emptyText: { textAlign: "center", color: "#999", padding: 32 },
  listContent: { padding: 16 },
});
