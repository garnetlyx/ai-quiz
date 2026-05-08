import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
} from "react-native";
import type {
  Topic,
  TopicMaterials,
  TopicScope,
  TopicScopeChapter,
} from "@ai-quiz/shared";

function newId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cloneScope(scope: TopicScope): TopicScope {
  return {
    chapters: scope.chapters.map((chapter) => ({
      ...chapter,
      items: chapter.items.map((item) => ({ ...item })),
    })),
  };
}

interface TopicEditorProps {
  topic: Topic;
  onSave: (data: {
    description: string;
    scope: TopicScope;
    materials: TopicMaterials;
  }) => Promise<void>;
  saveLabel?: string;
}

export function TopicEditor({ topic, onSave, saveLabel = "Save Scope" }: TopicEditorProps) {
  const [description, setDescription] = useState(topic.description);
  const [scope, setScope] = useState<TopicScope>(cloneScope(topic.scope));
  const [materials, setMaterials] = useState<TopicMaterials>({
    examples: topic.materials.examples || "",
    additionalTopics: topic.materials.additionalTopics || "",
    notes: topic.materials.notes || "",
    instructions: topic.materials.instructions || "",
  });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  const updateChapter = (
    chapterIndex: number,
    updater: (chapter: TopicScopeChapter) => TopicScopeChapter
  ) => {
    setScope((current) => ({
      chapters: current.chapters.map((chapter, index) =>
        index === chapterIndex ? updater(chapter) : chapter
      ),
    }));
  };

  const removeChapter = (chapterIndex: number) => {
    setScope((current) => ({
      chapters: current.chapters.filter((_, index) => index !== chapterIndex),
    }));
  };

  const handleSave = async () => {
    setError("");
    setIsSaving(true);
    try {
      await onSave({ description, scope, materials });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save topic");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={styles.editor}>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.label}>Description</Text>
      <TextInput
        style={[styles.input, styles.textArea]}
        value={description}
        onChangeText={setDescription}
        multiline
        placeholderTextColor="#999"
      />

      <Text style={styles.sectionTitle}>Chapters and Topics</Text>
      {scope.chapters.map((chapter, chapterIndex) => (
        <View key={chapter.id} style={styles.chapter}>
          <View style={styles.row}>
            <TextInput
              style={[styles.input, styles.chapterInput]}
              value={chapter.title}
              onChangeText={(title) =>
                updateChapter(chapterIndex, (current) => ({ ...current, title }))
              }
              placeholder="Chapter"
              placeholderTextColor="#999"
            />
            <Pressable style={styles.smallDanger} onPress={() => removeChapter(chapterIndex)}>
              <Text style={styles.smallDangerText}>Remove</Text>
            </Pressable>
          </View>

          {chapter.items.map((item, itemIndex) => (
            <View key={item.id} style={[styles.item, item.frozen && styles.itemFrozen]}>
              <View style={styles.row}>
                <TextInput
                  style={[styles.input, styles.itemTitle]}
                  value={item.title}
                  editable={!item.frozen}
                  onChangeText={(title) =>
                    updateChapter(chapterIndex, (current) => ({
                      ...current,
                      items: current.items.map((currentItem, index) =>
                        index === itemIndex ? { ...currentItem, title } : currentItem
                      ),
                    }))
                  }
                  placeholder="Topic"
                  placeholderTextColor="#999"
                />
                {item.frozen ? (
                  <Pressable
                    style={styles.smallButton}
                    onPress={() =>
                      updateChapter(chapterIndex, (current) => ({
                        ...current,
                        items: current.items.map((currentItem, index) =>
                          index === itemIndex ? { ...currentItem, frozen: false } : currentItem
                        ),
                      }))
                    }
                  >
                    <Text style={styles.smallButtonText}>Restore</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    style={styles.smallDanger}
                    onPress={() =>
                      updateChapter(chapterIndex, (current) => ({
                        ...current,
                        items: current.items.filter((_, index) => index !== itemIndex),
                      }))
                    }
                  >
                    <Text style={styles.smallDangerText}>Delete</Text>
                  </Pressable>
                )}
              </View>
              <TextInput
                style={styles.input}
                value={item.details}
                editable={!item.frozen}
                onChangeText={(details) =>
                  updateChapter(chapterIndex, (current) => ({
                    ...current,
                    items: current.items.map((currentItem, index) =>
                      index === itemIndex ? { ...currentItem, details } : currentItem
                    ),
                  }))
                }
                placeholder={item.frozen ? "Frozen because generated questions exist" : "Generation guidance"}
                placeholderTextColor="#999"
              />
            </View>
          ))}

          <Pressable
            style={styles.secondaryButton}
            onPress={() =>
              updateChapter(chapterIndex, (current) => ({
                ...current,
                items: [
                  ...current.items,
                  {
                    id: newId("item"),
                    title: "New topic",
                    details: "",
                    frozen: false,
                  },
                ],
              }))
            }
          >
            <Text style={styles.secondaryButtonText}>Add Topic</Text>
          </Pressable>
        </View>
      ))}

      <Pressable
        style={styles.secondaryButton}
        onPress={() =>
          setScope((current) => ({
            chapters: [
              ...current.chapters,
              {
                id: newId("chapter"),
                title: "New chapter",
                items: [
                  {
                    id: newId("item"),
                    title: "New topic",
                    details: "",
                    frozen: false,
                  },
                ],
              },
            ],
          }))
        }
      >
        <Text style={styles.secondaryButtonText}>Add Chapter</Text>
      </Pressable>

      <Text style={styles.sectionTitle}>Supplemental Material</Text>
      <TextInput
        style={[styles.input, styles.textArea]}
        value={materials.examples}
        onChangeText={(examples) => setMaterials((current) => ({ ...current, examples }))}
        placeholder="Example questions"
        multiline
        placeholderTextColor="#999"
      />
      <TextInput
        style={[styles.input, styles.textArea]}
        value={materials.additionalTopics}
        onChangeText={(additionalTopics) => setMaterials((current) => ({ ...current, additionalTopics }))}
        placeholder="Additional topics"
        multiline
        placeholderTextColor="#999"
      />
      <TextInput
        style={[styles.input, styles.textArea]}
        value={materials.instructions}
        onChangeText={(instructions) => setMaterials((current) => ({ ...current, instructions }))}
        placeholder="Generation instructions"
        multiline
        placeholderTextColor="#999"
      />
      <TextInput
        style={[styles.input, styles.textArea]}
        value={materials.notes}
        onChangeText={(notes) => setMaterials((current) => ({ ...current, notes }))}
        placeholder="Notes"
        multiline
        placeholderTextColor="#999"
      />

      <Pressable
        style={[styles.saveButton, isSaving && styles.disabled]}
        disabled={isSaving}
        onPress={handleSave}
      >
        <Text style={styles.saveButtonText}>{isSaving ? "Saving..." : saveLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  editor: { gap: 8 },
  label: { fontSize: 14, fontWeight: "600", color: "#333" },
  sectionTitle: { fontSize: 16, fontWeight: "700", marginTop: 12 },
  input: { borderWidth: 1, borderColor: "#ddd", borderRadius: 8, padding: 10, fontSize: 14, color: "#333", backgroundColor: "#fff" },
  textArea: { minHeight: 76, textAlignVertical: "top" },
  chapter: { borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, padding: 10, gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  chapterInput: { flex: 1, fontWeight: "700" },
  item: { gap: 8 },
  itemFrozen: { opacity: 0.75 },
  itemTitle: { flex: 1 },
  secondaryButton: { borderWidth: 1, borderColor: "#2563eb", padding: 10, borderRadius: 8, alignItems: "center" },
  secondaryButtonText: { color: "#2563eb", fontWeight: "600" },
  smallButton: { backgroundColor: "#2563eb", padding: 10, borderRadius: 6 },
  smallButtonText: { color: "#fff", fontWeight: "600" },
  smallDanger: { backgroundColor: "#fee2e2", padding: 10, borderRadius: 6 },
  smallDangerText: { color: "#b91c1c", fontWeight: "600" },
  saveButton: { backgroundColor: "#16a34a", padding: 14, borderRadius: 8, alignItems: "center", marginTop: 8 },
  saveButtonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  disabled: { opacity: 0.6 },
  error: { color: "#dc2626", fontSize: 14 },
});
