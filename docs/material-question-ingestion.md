# Material Question Ingestion Workflow

This workflow turns OCR text chunks into material-sourced practice questions.

## Full Bank Rebuild (preferred)

One deterministic, idempotent command rebuilds the whole WA agent bank and all
report artifacts in the same run — per-PDF extraction from `data/wa-agent/pdf/`,
practice tests from `data/wa-agent/4-exams/`, merge by contentHash, quiz-
eligibility guard, and optional import:

```sh
npm run rebuild:wa-agent --workspace=apps/api -- \
  --legacy-supplement=data/wa-agent/legacy-supplement-questions.json \
  --topic-id=<uuid> --replace-existing=true --build-scope=true
```

Omit `--topic-id` to rebuild the data files without importing. `--build-scope`
derives a topic scope from the bank's chapter metadata when the topic has no
scope yet; an existing curated scope is never overwritten.

`--legacy-supplement` carries the 194 questions (mostly Sample Exams 2/3 from
`Wa-agent3.pdf`) that were extracted by an unreproducible AI pass on 2026-08-08;
that PDF's text layer does not contain them, so they cannot be re-extracted
from source. Re-extracting scanned pages via the LLM vision OCR path is the
long-term replacement for this supplement.

The AI answer verifier runs by default when `OPENAI_API_KEY` is set (disable
with `MATERIAL_AI_VERIFY=false`); it only fills in missing answers for
otherwise-complete candidates.

Individual steps (rarely needed):

## Current WA Agent Extraction

Preferred: run from the original PDF so the extractor can use word coordinates and avoid mixing left/right columns:

```sh
MATERIAL_AI_SECTION_LIMIT=0 \
npm run extract:materials --workspace=apps/api -- \
  --input-pdf=/Users/gl/Dropbox/content/academic/RealEstateAgent_WA/wa-agent/Wa-agent.pdf \
  --output-dir=data/wa-agent
```

This also writes:

- `material-layout-text.txt`: coordinate-sorted intermediate text
- `material-layout-report.json`: page and column-detection diagnostics

Fallback: run from OCR text:

```sh
MATERIAL_AI_BASE_URL=http://mac-studio.local:4000/v1 \
MATERIAL_AI_MODEL=Qwen3.5-122B-A10B-4bit \
MATERIAL_AI_API_KEY=your-local-key \
MATERIAL_AI_SECTION_LIMIT=3 \
MATERIAL_AI_TIMEOUT_MS=20000 \
npm run extract:materials --workspace=apps/api
```

The local model is optional. Without the env vars, the deterministic parser still runs and flags more records for review.

Outputs are written to `data/wa-agent/`:

- `material-questions.json`: extracted question records
- `material-extraction-report.json`: counts and extraction health
- `material-review-items.json`: records that need human review
- `material-repair-diagnostics.json`: optional mapping from previous hidden/rejected records into current visible repair states

## Ingestion Flow

1. Split uploaded text into chunks with source file and line/page metadata.
2. Split extracted questions from the remaining helpful text chunks.
3. Classify each helpful chunk as `structure`, `context`, or `definition`.
4. Extract question chunks into the material-question schema.
5. Validate each extracted item:
   - question text is present
   - options are present and labeled
   - answers map to valid options
   - chapter, source, and location metadata are attached
6. Save high-confidence records as material-sourced questions.
7. Save helpful chunks separately:
   - `structure` -> pending scope suggestions
   - `context` -> material context plus topic notes
   - `definition` -> pending generation-instruction suggestions
8. Route low-confidence records to visible repair states instead of hiding, rejecting, or importing silently.

## Repair And Review States

- `ready`: directly usable by quiz generation.
- `auto_repaired`: repaired by the system or user and usable by quiz generation.
- `needs_repair`: visible system repair backlog. The app shows repair flags, attempted repair actions, raw/source evidence, and guided repair controls.
- `needs_user_review`: small user action queue after the pipeline cannot confidently choose the answer or wording.
- `unresolved`: still visible, retained with source evidence, and excluded from quiz unless repaired.

`needs_repair` is not counted as user manual review. It is repair debt. Manual review rate is computed from `needs_user_review / totalQuestions`; repair debt rate is computed from `(needs_repair + unresolved) / totalQuestions`.

Current guided user repair supports editing question text, filling fixed A-D option rows, selecting the correct answer, saving repaired records into `auto_repaired`, asking the user to review, excluding a record, or converting a candidate into helpful context.

## Helpful Content Effects

- `structure`: persists as helpful content and creates pending scope suggestions. Approving a scope suggestion merges suggested chapters/items into `topic.scope`.
- `context`: persists as helpful content, appends into `topic.materials.notes`, and is passed into AI question generation as imported material context.
- `definition`: persists as helpful content and creates pending generation-instruction suggestions. Approving a definition suggestion appends into `topic.materials.instructions`.

Generation instructions are injected into the question-generation prompt separately from notes/additional topics so output constraints such as bilingual explanations are not mixed into ordinary study context.

## JSON Shape

Each material question uses a future-ingestion schema:

```ts
{
  id: string;
  question: string;
  labels: string[];
  source: "example_question" | "chapter_question" | "exam_question";
  options: { id: "A" | "B" | "C" | "D"; text: string }[];
  answerLabels: ("A" | "B" | "C" | "D")[];
  correctAnswers: number[];
  answerExplanation: string | null;
  chapter: { number: number | null; title: string | null };
  exam: { number: number | null; questionNumber: number | null } | null;
  subtopic: string | null;
  subtopicTags: string[];
  confidence: number;
  reviewStatus: "ready" | "auto_repaired" | "needs_repair" | "needs_user_review" | "unresolved";
  repairFlags: string[];
  repairActions: { type: string; status: string; note: string }[];
  sourceLocation: {
    filePath: string;
    lineStart: number;
    lineEnd: number;
    sectionTitle: string | null;
  };
  contentHash: string;
  duplicateOf: string | null;
}
```

## OCR Notes

`data/wa-agent/Wa-agent.txt` comes from PDF OCR and includes two-column layout loss. Prefer `--input-pdf` because the PDF still preserves word coordinates. The PDF layout path groups words into lines, estimates page-local skew drift, detects single- vs two-column vertical bands, orders left column before right column, then feeds that text into the same question parser.

## WA Agent Benchmark

Latest 3-PDF column-aware run:

- `totalQuestions`: 594
- `readyQuestions`: 451
- `autoRepairedQuestions`: 0
- `needsRepairQuestions`: 116
- `needsUserReviewQuestions`: 27
- `unresolvedQuestions`: 0
- `manualReviewRate`: 0.0455
- `repairDebtRate`: 0.1953

The 116 previously hidden/rejected records are now visible as `needs_repair` with flags/actions in `data/wa-agent/benchmark-repair-visible/material-repair-diagnostics.json`. They are not claimed as automatically repaired.
