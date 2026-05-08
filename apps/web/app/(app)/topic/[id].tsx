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
import type {
  MaterialImportCreateResponse,
  MaterialImportJob,
  MaterialQuestionBankItem,
  MaterialQuestionUpdateRequest,
  MaterialReviewStatus,
  MaterialTextChunk,
  TopicUpdateSuggestion,
} from "@ai-quiz/shared";
import { TopicEditor } from "@/components/TopicEditor";

const OPTION_IDS = ["A", "B", "C", "D"] as const;

export default function TopicDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const currentTopic = useTopicStore((s) => s.currentTopic);
  const fetchTopic = useTopicStore((s) => s.fetchTopic);
  const updateTopic = useTopicStore((s) => s.updateTopic);
  const confirmFormat = useTopicStore((s) => s.confirmFormat);
  const isLoading = useTopicStore((s) => s.isLoading);
  const [activeTab, setActiveTab] = useState<"quiz" | "materials" | "scope" | "history" | "missed" | "subtopics">("quiz");
  const [history, setHistory] = useState<QuizHistoryEntry[]>([]);
  const [weakSubtopics, setWeakSubtopics] = useState<WeakSubtopic[]>([]);
  const [selectedSubtopics, setSelectedSubtopics] = useState<Set<string>>(new Set());
  const [missedCount, setMissedCount] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [setupError, setSetupError] = useState("");
  const [isConfirming, setIsConfirming] = useState(false);
  const [materialJobs, setMaterialJobs] = useState<MaterialImportJob[]>([]);
  const [materialQuestions, setMaterialQuestions] = useState<MaterialQuestionBankItem[]>([]);
  const [materialChunks, setMaterialChunks] = useState<MaterialTextChunk[]>([]);
  const [materialSuggestions, setMaterialSuggestions] = useState<TopicUpdateSuggestion[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [materialError, setMaterialError] = useState("");
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [questionDrafts, setQuestionDrafts] = useState<Record<string, MaterialQuestionUpdateRequest>>({});

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
    if (activeTab === "materials") {
      loadMaterials();
    }
  }, [id, activeTab]);

  useEffect(() => {
    if (activeTab !== "materials" || !id) return;
    const interval = setInterval(() => {
      if (materialJobs.some((job) => job.status === "queued" || job.status === "processing")) {
        loadMaterials();
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [activeTab, id, materialJobs]);

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

  const loadMaterials = async () => {
    if (!id) return;
    const [jobs, questions, chunks, suggestions] = await Promise.all([
      api.request<MaterialImportJob[]>(`/api/topics/${id}/material-imports`),
      api.request<MaterialQuestionBankItem[]>(`/api/topics/${id}/material-questions`),
      api.request<MaterialTextChunk[]>(`/api/topics/${id}/material-text-chunks`),
      api.request<TopicUpdateSuggestion[]>(`/api/topics/${id}/material-suggestions`),
    ]);
    setMaterialJobs(jobs);
    setMaterialQuestions(questions);
    setMaterialChunks(chunks);
    setMaterialSuggestions(suggestions);
  };

  const materialQuestionGroups = {
    repairBacklog: materialQuestions.filter((question) => question.reviewStatus === "needs_repair"),
    userReview: materialQuestions.filter((question) => question.reviewStatus === "needs_user_review"),
    unresolved: materialQuestions.filter((question) => question.reviewStatus === "unresolved"),
    ready: materialQuestions.filter((question) =>
      question.reviewStatus === "ready" || question.reviewStatus === "auto_repaired"
    ),
  };

  const getQuestionDraft = (question: MaterialQuestionBankItem): MaterialQuestionUpdateRequest => (
    questionDrafts[question.id] || {
      content: question.content,
      options: OPTION_IDS.map((optionId) => {
        const option = question.options.find((item) => item.id === optionId);
        return option || { id: optionId, text: "" };
      }),
      correctAnswers: question.correctAnswers,
      reviewStatus: question.reviewStatus,
      active: question.active,
    }
  );

  const setQuestionDraft = (
    question: MaterialQuestionBankItem,
    updater: (draft: MaterialQuestionUpdateRequest) => MaterialQuestionUpdateRequest
  ) => {
    setQuestionDrafts((prev) => ({
      ...prev,
      [question.id]: updater(getQuestionDraft(question)),
    }));
  };

  const repairFlagLabel = (flag: string) => flag.replace(/_/g, " ");

  const actionButtonText = (label: string) => (
    <Text style={styles.actionButtonText} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.75}>
      {label}
    </Text>
  );

  const reviewStatusLabel = (status: MaterialReviewStatus) => {
    if (status === "auto_repaired") return "repaired";
    if (status === "needs_repair") return "needs repair";
    if (status === "needs_user_review") return "user review";
    return status;
  };

  const updateDraftOption = (
    question: MaterialQuestionBankItem,
    optionIndex: number,
    text: string
  ) => {
    setQuestionDraft(question, (draft) => {
      const options = OPTION_IDS.map((optionId, index) => {
        const existing = (draft.options || []).find((option) => option.id === optionId) ||
          question.options.find((option) => option.id === optionId) ||
          { id: optionId, text: "" };
        return index === optionIndex ? { ...existing, text } : existing;
      });
      return { ...draft, options };
    });
  };

  const cleanedDraftOptions = (options: MaterialQuestionUpdateRequest["options"]) => (
    (options || []).filter((option) => option.text.trim().length > 0)
  );

  const renderQuestionActions = (
    question: MaterialQuestionBankItem,
    mode: "repair" | "review" | "ready" | "unresolved"
  ) => {
    const isEditing = editingQuestionId === question.id;
    const draft = getQuestionDraft(question);
    const options = draft.options || [];
    const correctAnswers = draft.correctAnswers || [];
    const completeOptions = cleanedDraftOptions(options);
    const canSaveAsQuestion = completeOptions.length >= 2 && correctAnswers.length > 0;
    const canSaveAsReady = completeOptions.length === 4 &&
      correctAnswers.length > 0 &&
      correctAnswers.every((index) => completeOptions[index]);

    return (
      <View style={styles.repairPanel}>
        {(question.repairFlags || []).length > 0 && (
          <View style={styles.pillRow}>
            {question.repairFlags.map((flag) => (
              <Text key={flag} style={styles.repairPill}>{repairFlagLabel(flag)}</Text>
            ))}
          </View>
        )}

        {(question.repairActions || []).slice(0, 3).map((action) => (
          <Text key={`${question.id}-${action.type}`} style={styles.repairAction}>
            {action.type.replace(/_/g, " ")} · {action.status}: {action.note}
          </Text>
        ))}

        <Text style={styles.historyMeta}>
          source {question.source}
          {question.sourceLocation?.lineStart ? ` · lines ${question.sourceLocation.lineStart}-${question.sourceLocation.lineEnd}` : ""}
          {question.active ? "" : " · excluded from quiz"}
        </Text>

        {question.rawCandidate?.question && question.rawCandidate.question !== question.content && (
          <Text style={styles.rawSource}>raw: {question.rawCandidate.question.slice(0, 220)}</Text>
        )}

        {isEditing && (
          <View style={styles.editPanel}>
            <TextInput
              style={[styles.input, styles.multilineInput]}
              multiline
              value={draft.content || ""}
              onChangeText={(text) => setQuestionDraft(question, (current) => ({ ...current, content: text }))}
            />
            {options.map((option, optionIndex) => (
              <View key={`${question.id}-${option.id}`} style={styles.optionEditRow}>
                <Pressable
                  style={[
                    styles.answerChoice,
                    correctAnswers.includes(optionIndex) && styles.answerChoiceSelected,
                  ]}
                  onPress={() => setQuestionDraft(question, (current) => ({
                    ...current,
                    correctAnswers: [optionIndex],
                  }))}
                >
                  <Text style={styles.answerChoiceText}>{option.id}</Text>
                </Pressable>
                <TextInput
                  style={[styles.input, styles.optionInput]}
                  value={option.text}
                  onChangeText={(text) => updateDraftOption(question, optionIndex, text)}
                />
              </View>
            ))}
          </View>
        )}

        {mode === "repair" && !isEditing && (
          <View style={styles.rowButtons}>
            <Pressable style={[styles.actionButton, styles.smallActionButton, styles.confirmButton]} onPress={() => setEditingQuestionId(question.id)}>
              {actionButtonText("Repair Fields")}
            </Pressable>
            <Pressable style={[styles.actionButton, styles.smallActionButton]} onPress={() => updateMaterialQuestion(question.id, { reviewStatus: "needs_user_review" })}>
              {actionButtonText("Ask User")}
            </Pressable>
            <Pressable style={[styles.actionButton, styles.smallActionButton, styles.neutralButton]} onPress={() => updateMaterialQuestion(question.id, { convertToContentKind: "context" })}>
              {actionButtonText("Use as Context")}
            </Pressable>
          </View>
        )}

        {mode === "review" && !isEditing && (
          <View style={styles.rowButtons}>
            <Pressable style={[styles.actionButton, styles.smallActionButton, styles.confirmButton]} onPress={() => updateMaterialQuestion(question.id, { reviewStatus: "ready" })}>
              {actionButtonText("Approve")}
            </Pressable>
            <Pressable style={[styles.actionButton, styles.smallActionButton]} onPress={() => setEditingQuestionId(question.id)}>
              {actionButtonText("Edit Answer")}
            </Pressable>
            <Pressable style={[styles.actionButton, styles.smallActionButton, styles.neutralButton]} onPress={() => updateMaterialQuestion(question.id, { active: false })}>
              {actionButtonText("Exclude")}
            </Pressable>
          </View>
        )}

        {isEditing && (
          <View style={styles.rowButtons}>
            <Pressable
              style={[styles.actionButton, styles.smallActionButton, styles.confirmButton]}
              onPress={() => updateMaterialQuestion(question.id, {
                content: draft.content,
                options: completeOptions,
                correctAnswers: correctAnswers.length > 0 ? correctAnswers : undefined,
                reviewStatus: canSaveAsReady ? "auto_repaired" : canSaveAsQuestion ? "needs_user_review" : "needs_repair",
                active: true,
              })}
            >
              {actionButtonText("Save Repair")}
            </Pressable>
            <Pressable style={[styles.actionButton, styles.smallActionButton, styles.neutralButton]} onPress={() => setEditingQuestionId(null)}>
              {actionButtonText("Cancel")}
            </Pressable>
          </View>
        )}
      </View>
    );
  };

  const renderQuestionCard = (
    question: MaterialQuestionBankItem,
    mode: "repair" | "review" | "ready" | "unresolved"
  ) => (
    <View key={question.id} style={styles.materialCard}>
      <Text style={styles.materialTitle}>{question.content}</Text>
      <Text style={styles.historyMeta}>
        {reviewStatusLabel(question.reviewStatus)} · {Math.round(question.confidence * 100)}%
      </Text>
      {renderQuestionActions(question, mode)}
    </View>
  );

  const handleMaterialUpload = async () => {
    if (!id || typeof document === "undefined") return;
    setMaterialError("");
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".pdf,.txt,.md,.markdown,image/png,image/jpeg,image/webp,image/tiff";
    input.onchange = async () => {
      const files = Array.from(input.files || []);
      if (files.length === 0) return;
      setIsUploading(true);
      try {
        const form = new FormData();
        files.forEach((file) => form.append("files", file));
        await api.request<MaterialImportCreateResponse>(`/api/topics/${id}/material-imports`, {
          method: "POST",
          body: form,
        });
        await loadMaterials();
      } catch (err) {
        setMaterialError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setIsUploading(false);
      }
    };
    input.click();
  };

  const updateMaterialQuestion = async (questionId: string, data: MaterialQuestionUpdateRequest) => {
    if (!id) return;
    await api.request(`/api/topics/${id}/material-questions/${questionId}`, {
      method: "PATCH",
      body: data,
    });
    setEditingQuestionId(null);
    setQuestionDrafts((prev) => {
      const next = { ...prev };
      delete next[questionId];
      return next;
    });
    await loadMaterials();
  };

  const updateSuggestion = async (suggestionId: string, status: "approved" | "rejected") => {
    if (!id) return;
    await api.request(`/api/topics/${id}/material-suggestions/${suggestionId}`, {
      method: "PATCH",
      body: { status },
    });
    await loadMaterials();
    await fetchTopic(id);
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
        {(["quiz", "materials", "scope", "history", "missed", "subtopics"] as const).map((tab) => (
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

      {activeTab === "materials" && (
        <ScrollView style={styles.tabContent}>
          <Pressable
            style={[styles.actionButton, isUploading && styles.disabled]}
            disabled={isUploading}
            onPress={handleMaterialUpload}
          >
            <Text style={styles.actionButtonText}>{isUploading ? "Uploading..." : "Upload Materials"}</Text>
          </Pressable>
          {materialError ? <Text style={styles.error}>{materialError}</Text> : null}

          <Text style={styles.materialHeading}>Import Jobs</Text>
          {materialJobs.map((job) => (
            <View key={job.id} style={styles.materialCard}>
              <Text style={styles.materialTitle}>{job.fileName}</Text>
              <Text style={styles.historyMeta}>{job.status} · {job.progress}%</Text>
              <Text style={styles.historyMeta}>
                ready {job.summary.readyCount || 0} · repaired {job.summary.autoRepairedCount || 0}
                {" · "}needs repair {job.summary.needsRepairCount || 0}
              </Text>
              <Text style={styles.historyMeta}>
                user review {job.summary.needsUserReviewCount || 0}
                {typeof job.summary.manualReviewRate === "number" ? ` (${Math.round(job.summary.manualReviewRate * 1000) / 10}%)` : ""}
                {" · "}unresolved {job.summary.unresolvedCount || 0}
              </Text>
              <Text style={styles.historyMeta}>
                repair debt {typeof job.summary.repairDebtRate === "number" ? `${Math.round(job.summary.repairDebtRate * 1000) / 10}%` : "0%"}
                {" · "}AI verified {job.summary.aiVerifiedCount || 0}
                {" · "}context {job.summary.contextCount || 0}
              </Text>
              {job.error ? <Text style={styles.error}>{job.error}</Text> : null}
            </View>
          ))}
          {materialJobs.length === 0 && <Text style={styles.emptyText}>No material uploads yet</Text>}

          <Text style={styles.materialHeading}>Repair Diagnostics</Text>
          <Text style={styles.historyMeta}>
            System repair backlog {materialQuestionGroups.repairBacklog.length} · user review {materialQuestionGroups.userReview.length}
            {" · "}unresolved {materialQuestionGroups.unresolved.length}
          </Text>
          {materialQuestionGroups.repairBacklog.slice(0, 10).map((question) => renderQuestionCard(question, "repair"))}
          {materialQuestionGroups.repairBacklog.length === 0 && (
            <Text style={styles.emptyText}>No system repair backlog</Text>
          )}

          <Text style={styles.materialHeading}>User Review Queue</Text>
          {materialQuestionGroups.userReview.slice(0, 10).map((question) => renderQuestionCard(question, "review"))}
          {materialQuestionGroups.userReview.length === 0 && (
            <Text style={styles.emptyText}>No user review items</Text>
          )}

          <Text style={styles.materialHeading}>Question Bank</Text>
          {materialQuestionGroups.ready.slice(0, 20).map((question) => renderQuestionCard(question, "ready"))}
          {materialQuestionGroups.ready.length === 0 && (
            <Text style={styles.emptyText}>No ready material questions yet</Text>
          )}

          {materialQuestionGroups.unresolved.length > 0 && (
            <>
              <Text style={styles.materialHeading}>Unresolved</Text>
              {materialQuestionGroups.unresolved.slice(0, 10).map((question) => renderQuestionCard(question, "unresolved"))}
            </>
          )}

          <Text style={styles.materialHeading}>Helpful Content</Text>
          {materialChunks.slice(0, 10).map((chunk) => (
            <View key={chunk.id} style={styles.materialCard}>
              <Text style={styles.historyMeta}>{chunk.kind}</Text>
              <Text style={styles.description}>{chunk.content.slice(0, 260)}</Text>
            </View>
          ))}

          <Text style={styles.materialHeading}>Suggested Updates</Text>
          {materialSuggestions.filter((item) => item.status === "pending").map((suggestion) => (
            <View key={suggestion.id} style={styles.materialCard}>
              <Text style={styles.materialTitle}>{suggestion.type}</Text>
              <Text style={styles.description}>{JSON.stringify(suggestion.payload).slice(0, 300)}</Text>
              <View style={styles.rowButtons}>
                <Pressable style={[styles.actionButton, styles.confirmButton]} onPress={() => updateSuggestion(suggestion.id, "approved")}>
                  <Text style={styles.actionButtonText}>Approve</Text>
                </Pressable>
                <Pressable style={[styles.actionButton, styles.rejectButton]} onPress={() => updateSuggestion(suggestion.id, "rejected")}>
                  <Text style={styles.actionButtonText}>Reject</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </ScrollView>
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
  multilineInput: { minHeight: 88, textAlignVertical: "top" },
  optionInput: { flex: 1, marginTop: 0 },
  rowButtons: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 8 },
  confirmButton: { flex: 1, backgroundColor: "#16a34a" },
  rejectButton: { flex: 1, backgroundColor: "#dc2626" },
  neutralButton: { flex: 1, backgroundColor: "#475569" },
  disabled: { opacity: 0.6 },
  tabs: { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#eee" },
  tab: { flex: 1, paddingVertical: 12, alignItems: "center" },
  tabActive: { borderBottomWidth: 2, borderBottomColor: "#2563eb" },
  tabText: { fontSize: 14, color: "#666" },
  tabTextActive: { color: "#2563eb", fontWeight: "600" },
  tabContent: { padding: 16 },
  actionButton: { backgroundColor: "#2563eb", padding: 14, borderRadius: 8, alignItems: "center" },
  smallActionButton: { minWidth: 132, minHeight: 48, justifyContent: "center" },
  actionButtonText: { color: "#fff", fontSize: 16, fontWeight: "600", textAlign: "center" },
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
  materialHeading: { fontSize: 16, fontWeight: "700", marginTop: 20, marginBottom: 8 },
  materialCard: { backgroundColor: "#fff", padding: 12, borderRadius: 8, marginBottom: 8 },
  materialTitle: { fontSize: 14, fontWeight: "600", marginBottom: 4 },
  repairPanel: { marginTop: 8, gap: 6 },
  repairAction: { fontSize: 13, color: "#475569", lineHeight: 18 },
  rawSource: { fontSize: 12, color: "#777", backgroundColor: "#f8fafc", padding: 8, borderRadius: 6 },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  repairPill: { fontSize: 12, color: "#7c2d12", backgroundColor: "#ffedd5", paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6 },
  editPanel: { gap: 8, marginTop: 8 },
  optionEditRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  answerChoice: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: "#cbd5e1", alignItems: "center", justifyContent: "center", backgroundColor: "#fff" },
  answerChoiceSelected: { backgroundColor: "#16a34a", borderColor: "#16a34a" },
  answerChoiceText: { fontSize: 14, fontWeight: "700", color: "#334155" },
});
