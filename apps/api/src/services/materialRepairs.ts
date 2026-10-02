import { createHash } from "node:crypto";
import { z } from "zod";
import { materialAuditFingerprint } from "./materialBank.js";
import type { MaterialQuestion } from "./materialExtraction.js";

const label = z.enum(["A", "B", "C", "D"]);
const text = z.string().trim().min(1);
const repairSchema = z.object({
  questionId: text,
  inputFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  kind: z.enum(["source_recovery", "ai_adaptation"]),
  question: text,
  options: z.array(z.object({ id: label, text })).length(label.options.length),
  answerLabels: z.array(label).length(1),
  // Many printed questions have no explanation; none is invented.
  answerExplanation: text.nullable(),
  chapter: z.object({ number: z.number().int().nullable(), title: text.nullable() }).optional(),
  subtopic: text.optional(),
  subtopicTags: z.array(text).min(1).optional(),
  labels: z.array(text).min(1).optional(),
  evidence: z.array(z.object({ source: text, locator: text, quote: text })).min(1),
  note: text,
}).strict();

export type MaterialContentRepair = z.infer<typeof repairSchema>;

// Repairs are proposals tied to the exact source candidate. Applying one does
// not create an audit verdict: the changed content must pass independent review.
export function applyMaterialRepairs(questions: MaterialQuestion[], input: unknown) {
  const repairs = z.array(repairSchema).parse(input);
  const byId = new Map(questions.map(question => [question.id, question]));
  const targets = new Map<string, MaterialContentRepair>();
  for (const repair of repairs) {
    if (targets.has(repair.questionId)) throw new Error(`Duplicate repair for ${repair.questionId}`);
    const original = byId.get(repair.questionId);
    if (!original) throw new Error(`Repair target ${repair.questionId} not found`);
    if (materialAuditFingerprint(original) !== repair.inputFingerprint) {
      throw new Error(`Stale repair for ${repair.questionId}; recheck the changed source candidate`);
    }
    if (new Set(repair.options.map(option => option.id)).size !== label.options.length) {
      throw new Error(`Repair ${repair.questionId} must contain each option label exactly once`);
    }
    if (new Set(repair.options.map(option => option.text.toLowerCase().replace(/\s+/g, " "))).size !== label.options.length) {
      throw new Error(`Repair ${repair.questionId} has duplicate answer choices`);
    }
    targets.set(repair.questionId, repair);
  }

  return {
    applied: repairs.length,
    questions: questions.map(question => {
      const repair = targets.get(question.id);
      if (!repair) return question;
      const options = label.options.map(id => ({ ...repair.options.find(option => option.id === id)! }));
      const contentHash = createHash("sha256")
        .update(`${repair.question}\n${options.map(option => `${option.id}.${option.text}`).join("\n")}`)
        .digest("hex");
      return {
        ...question,
        question: repair.question,
        options,
        answerLabels: [...repair.answerLabels],
        correctAnswers: repair.answerLabels.map(id => options.findIndex(option => option.id === id)),
        answerExplanation: repair.answerExplanation,
        chapter: repair.chapter ? { ...repair.chapter } : question.chapter,
        subtopic: repair.subtopic ?? question.subtopic,
        subtopicTags: repair.subtopicTags ? [...repair.subtopicTags] : question.subtopicTags,
        labels: repair.labels ? [...repair.labels] : question.labels,
        contentHash,
        reviewStatus: "auto_repaired" as const,
        repairFlags: [],
        repairActions: [...question.repairActions, {
          type: repair.kind === "ai_adaptation" ? "ai_content_repair" : "source_content_repair",
          status: "applied" as const,
          note: `${repair.note} Input fingerprint: ${repair.inputFingerprint}. Evidence: ${JSON.stringify(repair.evidence)}`,
        }],
      };
    }),
  };
}
