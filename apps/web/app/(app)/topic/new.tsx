import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  FlatList,
} from "react-native";
import { useRouter } from "expo-router";
import { useTopicStore } from "@/stores/topic";
import type { TopicCreateResponse } from "@ai-quiz/shared";
import { TopicEditor } from "@/components/TopicEditor";

export default function NewTopicScreen() {
  const [description, setDescription] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [response, setResponse] = useState<TopicCreateResponse | null>(null);
  const [feedback, setFeedback] = useState("");
  const [currentTopicId, setCurrentTopicId] = useState<string | null>(null);

  const createTopic = useTopicStore((s) => s.createTopic);
  const confirmFormat = useTopicStore((s) => s.confirmFormat);
  const updateTopic = useTopicStore((s) => s.updateTopic);
  const router = useRouter();

  const handleSubmit = async () => {
    setError("");
    setIsLoading(true);
    try {
      const res = await createTopic(description);
      setResponse(res);
      if (res.topic) {
        setCurrentTopicId(res.topic.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create topic");
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmFormat = async (confirmed: boolean) => {
    if (!currentTopicId) return;
    setIsLoading(true);
    try {
      await confirmFormat(currentTopicId, confirmed, confirmed ? undefined : feedback);
      if (confirmed) {
        router.replace(`/(app)/topic/${currentTopicId}`);
      } else {
        setFeedback("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to confirm format");
    } finally {
      setIsLoading(false);
    }
  };

  if (response?.status === "needs_clarification") {
    return (
      <View style={styles.container}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Clarification Needed</Text>
          <Text style={styles.cardText}>{response.clarification}</Text>

          {response.suggestedTopics && response.suggestedTopics.length > 0 && (
            <>
              <Text style={styles.suggestTitle}>Suggested topics:</Text>
              <FlatList
                data={response.suggestedTopics}
                keyExtractor={(item, i) => `${i}`}
                renderItem={({ item }) => (
                  <Pressable
                    style={styles.suggestionChip}
                    onPress={() => {
                      setDescription(item);
                      setResponse(null);
                    }}
                  >
                    <Text style={styles.suggestionText}>{item}</Text>
                  </Pressable>
                )}
              />
            </>
          )}

          <TextInput
            style={styles.input}
            placeholder="Try a more specific description..."
            value={description}
            onChangeText={(t) => {
              setDescription(t);
              setResponse(null);
            }}
            placeholderTextColor="#999"
          />
          <Pressable style={styles.button} onPress={handleSubmit}>
            <Text style={styles.buttonText}>Submit Again</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (response?.status === "format_detected" && response.examFormat && currentTopicId) {
    const topic = response.topic;
    if (!topic) return null;
    return (
      <View style={styles.container}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Exam Format Detected</Text>
          <Text style={styles.cardText}>
            {response.examFormat.choicesCount} choices per question
          </Text>
          <Text style={styles.cardText}>
            {response.examFormat.isMultiSelect ? "Multiple answers possible" : "Single answer per question"}
          </Text>

          <TopicEditor
            topic={topic}
            saveLabel="Save Scope"
            onSave={async (data) => {
              const updated = await updateTopic(currentTopicId, data);
              setResponse((current) =>
                current ? { ...current, topic: updated } : current
              );
            }}
          />

          <View style={styles.rowButtons}>
            <Pressable
              style={[styles.button, styles.confirmButton]}
              onPress={() => handleConfirmFormat(true)}
            >
              <Text style={styles.buttonText}>Confirm</Text>
            </Pressable>
            <Pressable
              style={[styles.button, styles.rejectButton]}
              onPress={() => handleConfirmFormat(false)}
            >
              <Text style={styles.buttonText}>Wrong Format</Text>
            </Pressable>
          </View>

          <TextInput
            style={styles.input}
            placeholder="Describe what's wrong (optional)..."
            value={feedback}
            onChangeText={setFeedback}
            placeholderTextColor="#999"
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>New Quiz Topic</Text>
        <Text style={styles.cardSubtext}>
          Describe the exam you want to practice for
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder='e.g. "Real estate broker exam in California"'
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={4}
          placeholderTextColor="#999"
        />

        <Pressable
          style={[styles.button, (!description.trim() || isLoading) && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={!description.trim() || isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Create Topic</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5", padding: 16, justifyContent: "center" },
  card: { backgroundColor: "#fff", padding: 24, borderRadius: 12, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 8, elevation: 4 },
  cardTitle: { fontSize: 22, fontWeight: "700", marginBottom: 8 },
  cardSubtext: { fontSize: 14, color: "#666", marginBottom: 16 },
  cardText: { fontSize: 16, color: "#333", marginBottom: 8 },
  error: { color: "#dc2626", marginBottom: 12, fontSize: 14 },
  input: { borderWidth: 1, borderColor: "#ddd", borderRadius: 8, padding: 12, fontSize: 16, color: "#333", marginBottom: 12 },
  textArea: { minHeight: 100, textAlignVertical: "top" },
  button: { backgroundColor: "#2563eb", padding: 14, borderRadius: 8, alignItems: "center", marginTop: 4 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  suggestTitle: { fontSize: 14, fontWeight: "600", marginTop: 12, marginBottom: 8 },
  suggestionChip: { backgroundColor: "#eff6ff", padding: 10, borderRadius: 6, marginBottom: 8 },
  suggestionText: { color: "#2563eb", fontSize: 14 },
  rowButtons: { flexDirection: "row", gap: 12, marginBottom: 12 },
  confirmButton: { flex: 1, backgroundColor: "#16a34a" },
  rejectButton: { flex: 1, backgroundColor: "#dc2626" },
});
