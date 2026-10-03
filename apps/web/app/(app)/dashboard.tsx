import { useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  Alert,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { useAuthStore } from "@/stores/auth";
import { useTopicStore } from "@/stores/topic";
import type { Topic } from "@ai-quiz/shared";

export default function DashboardScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const topics = useTopicStore((s) => s.topics);
  const fetchTopics = useTopicStore((s) => s.fetchTopics);
  const deleteTopic = useTopicStore((s) => s.deleteTopic);
  const isLoading = useTopicStore((s) => s.isLoading);
  const [deletingTopicId, setDeletingTopicId] = useState<string | null>(null);

  useEffect(() => {
    fetchTopics();
  }, [fetchTopics]);

  const handleLogout = () => {
    logout();
    router.replace("/(auth)/login");
  };

  const deleteTopicAfterConfirmation = async (topic: Topic) => {
    setDeletingTopicId(topic.id);
    try {
      await deleteTopic(topic.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete topic");
    } finally {
      setDeletingTopicId(null);
    }
  };

  const handleDeleteTopic = (topic: Topic) => {
    if (Platform.OS === "web") {
      const confirmed = window.confirm(
        `Remove "${topic.title}" from your dashboard? Quiz history is preserved internally.`
      );
      if (confirmed) {
        void deleteTopicAfterConfirmation(topic);
      }
      return;
    }

    Alert.alert(
      "Delete topic?",
      `Remove "${topic.title}" from your dashboard? Quiz history is preserved internally.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void deleteTopicAfterConfirmation(topic);
          },
        },
      ]
    );
  };

  const renderTopic = ({ item }: { item: Topic }) => (
    <View style={styles.topicCard}>
      <View style={styles.topicHeader}>
        <Pressable
          style={styles.topicBody}
          onPress={() => router.push(`/(app)/topic/${item.id}`)}
        >
          <Text style={styles.topicTitle}>{item.title}</Text>
          <Text style={styles.topicDesc} numberOfLines={2}>
            {item.description}
          </Text>
          <View style={styles.topicMeta}>
            <Text
              style={[
                styles.topicStatus,
                item.status !== "confirmed" && styles.topicStatusDraft,
              ]}
            >
              {item.status === "confirmed" ? "Ready" : "Setup needed"}
            </Text>
            {item.examFormat && (
              <Text style={styles.topicFormat}>
                {item.examFormat.choicesCount} choices
                {item.examFormat.isMultiSelect ? " (multi)" : ""}
              </Text>
            )}
          </View>
          {item.status !== "confirmed" && (
            <Text style={styles.resumeSetup}>Resume setup</Text>
          )}
        </Pressable>
        <Pressable
          style={styles.deleteButton}
          disabled={deletingTopicId === item.id}
          onPress={() => handleDeleteTopic(item)}
        >
          <Text style={styles.deleteButtonText}>
            {deletingTopicId === item.id ? "Removing..." : "Delete"}
          </Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Welcome back</Text>
          <Text style={styles.email}>{user?.email}</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable onPress={handleLogout}>
            <Text style={styles.logout}>Sign Out</Text>
          </Pressable>
        </View>
      </View>

      <Pressable
        style={styles.newTopicButton}
        onPress={() => router.push("/(app)/topic/new")}
      >
        <Text style={styles.newTopicButtonText}>+ New Topic</Text>
      </Pressable>

      {isLoading ? (
        <ActivityIndicator size="large" style={styles.loader} />
      ) : topics.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No topics yet</Text>
          <Text style={styles.emptySubtext}>
            Create your first topic to start practicing
          </Text>
        </View>
      ) : (
        <FlatList
          data={topics}
          keyExtractor={(item) => item.id}
          renderItem={renderTopic}
          contentContainerStyle={styles.list}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#eee" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 12 },
  greeting: { fontSize: 18, fontWeight: "600" },
  email: { fontSize: 14, color: "#666", marginTop: 2 },
  logout: { color: "#dc2626", fontSize: 14 },
  newTopicButton: { backgroundColor: "#2563eb", margin: 16, padding: 14, borderRadius: 8, alignItems: "center" },
  newTopicButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  loader: { marginTop: 40 },
  empty: { flex: 1, justifyContent: "center", alignItems: "center", padding: 32 },
  emptyText: { fontSize: 18, fontWeight: "600", color: "#666" },
  emptySubtext: { fontSize: 14, color: "#999", marginTop: 8, textAlign: "center" },
  list: { padding: 16, paddingTop: 0 },
  topicCard: { backgroundColor: "#fff", padding: 16, borderRadius: 8, marginBottom: 12, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  topicHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  topicBody: { flex: 1 },
  topicTitle: { fontSize: 18, fontWeight: "600", marginBottom: 4 },
  topicDesc: { fontSize: 14, color: "#666", marginBottom: 8 },
  topicMeta: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  topicStatus: { fontSize: 12, color: "#2563eb", fontWeight: "500" },
  topicStatusDraft: { color: "#b45309" },
  topicFormat: { fontSize: 12, color: "#999" },
  resumeSetup: { color: "#2563eb", fontSize: 14, fontWeight: "600", marginTop: 12 },
  deleteButton: { backgroundColor: "#fee2e2", paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6 },
  deleteButtonText: { color: "#b91c1c", fontSize: 12, fontWeight: "600" },
});
