# AI Quiz - Architecture

## Overview

Monorepo with two apps, a web frontend and an API backend, plus a shared package for cross-app types. The frontend is an Expo React Native web app. The backend is a Fastify server exposing REST APIs for auth, topic setup, material ingestion, quiz generation, search verification, scoring, and history.

## Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Frontend | React Native (Expo) + Expo Router | Web-first with future iOS and Android adaptation |
| Backend | Node.js + Fastify | Fast, schema-based validation, TypeScript-native |
| Database | PostgreSQL + Drizzle ORM | Relational model fits the domain, Drizzle is type-safe and lightweight |
| Queue | Redis + BullMQ | Async material import jobs for long-running PDF and OCR work |
| AI | OpenAI-compatible SDK | Configurable endpoint supports local models, OpenAI, and proxy providers |
| Search | Exa MCP primary, SearXNG fallback, Brave Search API fallback | Higher-quality primary search with local and API fallbacks |
| Uploads | @fastify/multipart | Streams PDF, image, and text uploads into import jobs |
| Image processing | sharp | Available for uploaded image processing |
| Auth | bcrypt + JWT | Simple, stateless auth for MVP |
| Monorepo | npm workspaces | Shared types and simple setup without extra tooling |

## Directory Structure

```
ai-quiz/
├── apps/
│   ├── web/                      # Expo web app
│   │   ├── app/                  # Expo Router pages
│   │   │   ├── (auth)/           # Login, register screens
│   │   │   ├── (app)/            # Authenticated screens
│   │   │   │   ├── dashboard.tsx
│   │   │   │   ├── topic/new.tsx
│   │   │   │   ├── topic/[id].tsx
│   │   │   │   ├── quiz/setup.tsx
│   │   │   │   ├── quiz/[sessionId].tsx
│   │   │   │   └── results/[sessionId].tsx
│   │   │   └── _layout.tsx
│   │   ├── components/TopicEditor.tsx
│   │   ├── services/api.ts
│   │   └── stores/               # auth.ts, quiz.ts, topic.ts
│   │
│   └── api/                      # Fastify backend
│       ├── src/
│       │   ├── app.ts            # Fastify builder, plugins, routes, worker startup
│       │   ├── server.ts         # Runtime entry and env validation
│       │   ├── env.ts            # .env discovery and loading
│       │   ├── routes/           # auth.ts, topics.ts, quiz.ts, history.ts
│       │   ├── services/         # 8 service files
│       │   │   ├── ai.ts
│       │   │   ├── search.ts
│       │   │   ├── scope.ts
│       │   │   ├── quiz.ts
│       │   │   ├── materialImport.ts
│       │   │   ├── materialExtraction.ts
│       │   │   ├── materialVerification.ts
│       │   │   └── pdfLayoutText.ts
│       │   ├── prompts/          # topic, format, scope, question prompts
│       │   ├── db/               # index.ts, schema.ts, migrations/
│       │   ├── plugins/auth.ts
│       │   └── scripts/extract-material-questions.ts
│       └── tests/
│           ├── health.test.ts
│           ├── materialExtraction.test.ts
│           ├── pdfLayoutText.test.ts
│           ├── questionGeneratePrompt.test.ts
│           ├── scope.test.ts
│           ├── search.test.ts
│           └── topics.test.ts
│
├── packages/shared/src/          # index.ts, types.ts
├── docs/                         # PRD, architecture, tasks, session log
├── searxng/settings.yml
├── docker-compose.yml            # PostgreSQL + SearXNG + Redis
├── package.json
└── tsconfig.base.json
```

## Database Schema

### users

Registered accounts. Columns: `id`, `email`, `passwordHash`, `createdAt`. Email has a unique index.

### topics

Exam targets and setup state. Columns: `id`, `userId`, `title`, `description`, `scope`, `materials`, `examFormat`, `status`, `createdAt`, `archivedAt`. `status` is `draft` or `confirmed`. `archivedAt` is a soft-delete timestamp. Active topic queries filter it with `isNull(topics.archivedAt)`.

### material_import_jobs

Tracks uploaded material processing. Columns: `id`, `topicId`, `userId`, `fileName`, `filePath`, `mimeType`, `status`, `progress`, `error`, `summary`, `createdAt`, `updatedAt`, `completedAt`. Status is `queued`, `processing`, `completed`, or `failed`. `summary` stores counts for extracted questions, review states, chunks, duplicate questions, AI verification, and unmatched answers.

### material_questions

Question bank extracted from uploaded materials. Columns: `id`, `topicId`, `jobId`, `content`, `options`, `correctAnswers`, `explanations`, `subtopicTags`, `scopeItemId`, `source`, `sourceLocation`, `confidence`, `reviewStatus`, `repairFlags`, `repairActions`, `rawCandidate`, `active`, `contentHash`, `createdAt`, `updatedAt`. Source is `example_question`, `chapter_question`, or `exam_question`. Review status is `ready`, `auto_repaired`, `needs_repair`, `needs_user_review`, or `unresolved`. The extraction result includes `duplicateOf`; persistence uses a unique `(topicId, contentHash)` index and conflict-ignore inserts.

### material_text_chunks

Useful non-question text from imported materials. Columns: `id`, `topicId`, `jobId`, `kind`, `content`, `labels`, `sourceLocation`, `confidence`, `active`, `createdAt`. Kind is `structure`, `context`, or `definition`.

### topic_update_suggestions

Pending changes generated from imported materials. Columns: `id`, `topicId`, `jobId`, `type`, `status`, `payload`, `createdAt`, `updatedAt`. Type is `scope` or `definition`. Status is `pending`, `approved`, or `rejected`.

### quiz_sessions

Quiz attempts. Columns: `id`, `topicId`, `questionCount`, `timerEnabled`, `timerDurationSeconds`, `score`, `completedAt`, `mode`, `subtopicFilter`, `createdAt`. Mode is `normal`, `retry`, or `subtopic`.

### questions

Questions used in quiz sessions. Columns: `id`, `sessionId`, `topicId`, `content`, `options`, `correctAnswers`, `explanations`, `subtopicTags`, `scopeItemId`, `materialQuestionId`, `userAnswers`, `isCorrect`, `isFlagged`, `flagReason`, `contentHash`, `position`. `materialQuestionId` links quiz rows back to imported material-bank questions when used.

## Core Components

### 1. Topic Interpretation Pipeline

```
User input (free text)
  -> AI interprets topic and detects ambiguity
  -> If ambiguous: return clarification request
  -> AI detects exam format, choices count, single or multi-select
  -> AI proposes editable chapter/subtopic scope
  -> Save topic as draft with detected format and generated scope
  -> Present setup UI for user confirmation
  -> If rejected: user feedback + Exa/SearXNG/Brave context -> AI refines format
  -> If accepted: topic status becomes confirmed
```

### 2. Topic Setup Resume Flow

```
User opens topic detail
  -> GET /api/topics/:id returns status and examFormat
  -> Draft topics show setup UI instead of normal practice state
  -> User can edit scope/material fields and import more materials
  -> User confirms format after reviewing imported context
  -> POST /api/topics/:id/confirm-format marks topic confirmed
  -> Confirmed topics can start normal, retry, or subtopic quizzes
```

Draft topics keep import jobs, extracted questions, chunks, and suggestions so setup can resume across sessions.

### 3. Scope Edit Flow

```
User edits scope in TopicEditor
  -> PATCH /api/topics/:id with updated scope + materials
  -> scope.ts normalizes scope and materials
  -> mergeScopeWithUsage compares changes with existing questions
      -> used removed items become frozen
      -> unused removed items disappear
      -> new items are added as active
  -> Future quiz generation uses activeScopeItems only
```

### 4. Material Ingestion Pipeline

```
User uploads PDF, image, or text material
  -> POST /api/topics/:id/material-imports streams files through @fastify/multipart
  -> materialImport.ts validates active topic, stores file, creates material_import_jobs row
  -> BullMQ enqueues a material-imports job in Redis when REDIS_URL is set
  -> Fallback processing runs if no queue is available
  -> Worker extracts text
      -> PDF: pdfLayoutText.ts calls pdftotext -bbox, groups word boxes into lines, detects two-column layout, emits reading-order text
      -> Image: tesseract OCR
      -> Text: UTF-8 read
  -> materialExtraction.ts parses example, chapter, and exam questions
  -> Parser assigns source locations, content hashes, confidence, repair flags, repair actions, and review statuses
  -> materialVerification.ts can AI-verify orphan questions missing answer labels
  -> materialImport.ts stores questions in material_questions with per-topic content hash dedup
  -> Non-question paragraphs become material_text_chunks
  -> Structure and definition chunks create topic_update_suggestions
  -> Context chunks are merged into topic materials.notes for prompt context
  -> Job summary, progress, and completion fields are updated
  -> User reviews questions, converts bad candidates to chunks, and approves or rejects suggestions
```

Review status is a continuum:

- `ready`: clean enough to feed quiz generation.
- `auto_repaired`: repaired automatically and eligible for quiz generation.
- `needs_repair`: structurally incomplete or polluted.
- `needs_user_review`: plausible, but needs manual confirmation.
- `unresolved`: rejected, converted to content, or still unusable.

### 5. Material Suggestions Flow

```
Imported structure or definition chunks
  -> materialImport.ts creates pending topic_update_suggestions
  -> GET /api/topics/:id/material-suggestions lists suggestions
  -> User approves or rejects each suggestion
  -> PATCH /api/topics/:id/material-suggestions/:sid updates status
  -> Approved definition suggestion appends instructions to topic materials
  -> Approved scope suggestion merges suggested chapters/items into topic scope
  -> Rejected suggestion stays recorded without changing topic data
```

Approved scope suggestions use `mergeSuggestedScope` so imported structure extends the current topic instead of replacing user edits. Approved definition suggestions append imported instructions to `materials.instructions`.

### 6. Question Generation Pipeline

```
Topic + format + active scope + supplemental materials + material chunks + existing hashes
  -> quiz.ts loads ready/auto_repaired active material_questions not yet attempted
  -> Apply optional subtopic filter to material bank
  -> Select material-bank questions first
  -> If needed, AI generates the remainder with scope plan, material context, instructions, and existing hashes
  -> Assign AI questions across active scope items
  -> Deduplicate AI questions against question pool by content_hash
  -> Optional fact-check request uses Exa MCP, then SearXNG, then Brave
  -> Store copied material questions and generated AI questions in questions
  -> Return active quiz questions to client with answers hidden
```

### 7. Quiz Flow

```
Client requests quiz -> API creates quiz session and question rows
  -> Client presents questions one by one
  -> User answers locally
  -> User submits all answers
  -> API validates single-select vs multi-select rules
  -> API scores and stores userAnswers, isCorrect, score, completedAt
  -> API returns result summary with explanations
```

### 8. Weak Subtopic Tracking

```
On quiz completion
  -> Aggregate missed, unflagged question subtopic_tags per active topic scope
  -> Return weak subtopics sorted by miss rate
  -> User can request a subtopic-filtered quiz
  -> Retry mode copies missed, unflagged questions into a new quiz session
```

### 9. Topic Archive Flow

```
User deletes a topic
  -> DELETE /api/topics/:id
  -> API sets topics.archivedAt instead of deleting rows
  -> Topic list, detail, setup, quiz, history, and material routes filter archived topics
  -> Existing quiz, question, import, material question, and chunk rows stay intact
```

Soft-delete preserves referential integrity with quiz history and imported material records.

## API Design

### Auth

- `POST /api/auth/register`: Create account and return JWT.
- `POST /api/auth/login`: Validate credentials and return JWT.

### Topics

- `POST /api/topics`: Create draft topic, interpret topic, detect format, generate scope.
- `POST /api/topics/:id/confirm-format`: Confirm format or reject with feedback for refinement.
- `GET /api/topics`: List active topics for the user.
- `GET /api/topics/:id`: Get active topic detail.
- `PATCH /api/topics/:id`: Edit description, scope, examples, notes, instructions, and additional topics.
- `DELETE /api/topics/:id`: Soft-delete topic by setting `archivedAt`.

### Material Imports and Review

- `POST /api/topics/:id/material-imports`: Upload PDF, image, or text files and create import jobs.
- `GET /api/topics/:id/material-imports`: List import jobs.
- `GET /api/topics/:id/material-imports/:jobId`: Get one job status.
- `GET /api/topics/:id/material-questions`: List extracted questions, optionally filtered by status.
- `PATCH /api/topics/:id/material-questions/:qid`: Update review status, edit question fields, deactivate, or convert to a text chunk.
- `GET /api/topics/:id/material-text-chunks`: List context, structure, and definition chunks.
- `GET /api/topics/:id/material-suggestions`: List scope and definition suggestions.
- `PATCH /api/topics/:id/material-suggestions/:sid`: Approve or reject a suggestion.

### Quiz

- `POST /api/topics/:id/quiz`: Start quiz with hybrid material-bank and AI generation.
- `POST /api/topics/:topicId/quiz/retry`: Create retry quiz from missed, unflagged questions.
- `POST /api/quiz/:id/submit`: Submit answers and get scored results.
- `GET /api/quiz/:id`: Get quiz details and results.
- `POST /api/quiz/:id/questions/:qid/flag`: Flag a question.

### History

- `GET /api/topics/:id/history`: Paginated quiz sessions for a topic.
- `GET /api/topics/:id/missed`: Missed question set.
- `GET /api/topics/:id/weak-subtopics`: Weak subtopics ranking.

### Health

- `GET /api/health`: Returns `{ status: "ok" }`.

## Data Flow

```
Expo Web <-> Fastify API <-> AI Model
                  |
                  +-> Exa MCP -> SearXNG -> Brave Search
                  |
                  +-> PostgreSQL
                  |
                  +-> Redis + BullMQ -> materialImport worker
                                      -> PDF/image/text extraction
                                      -> material_questions
                                      -> material_text_chunks
                                      -> topic_update_suggestions

Quiz generation reads active scope, topic materials, material_text_chunks, and ready material_questions. It uses material-bank questions first, then asks AI to fill any remaining count.
```

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Monorepo | npm workspaces | Shared types, simple setup, no extra tooling |
| ORM | Drizzle | Type-safe, lightweight, good migration story |
| API composition | `app.ts` builder + `server.ts` runtime entry | Tests can build the app without listening on a port |
| Environment loading | `env.ts` searches upward for `.env` | Works from workspace root and app directory |
| Auth plugin | `plugins/auth.ts` with Fastify JWT | Central authenticate hook for protected routes |
| State management | Zustand | Minimal boilerplate for React Native |
| AI prompt storage | Code files in `prompts/` | Version-controlled, easy to iterate |
| Search order | Exa MCP -> SearXNG -> Brave | Exa gives higher-quality results, SearXNG keeps local dev viable, Brave is final fallback |
| Material import queue | Redis + BullMQ | PDF extraction and OCR can take longer than an HTTP request should block |
| Upload handling | @fastify/multipart | Supports multi-file uploads while respecting size limits |
| Content dedup | SHA-256 hash of normalized question text | Fast lookup for AI quiz questions and imported material questions |
| Material question bank | `material_questions` separate from session `questions` | Users can review imported questions once and reuse them across quizzes |
| Hybrid generation | Material bank first, AI fills gaps | Imported exam material is used when available without blocking practice when the bank is small |
| Review status continuum | ready -> auto_repaired -> needs_repair -> needs_user_review -> unresolved | Separates usable, repaired, questionable, and unusable imported questions |
| Text chunks | Store context, structure, and definition separately | Context can guide prompts, structure can update scope, definitions can update instructions |
| Topic suggestions | Pending scope and definition rows | Imported material proposes changes without silently overwriting user setup |
| Soft-delete topics | `archivedAt` timestamp | Preserves referential integrity with quiz history and material import records |
| Scope edits | Freeze removed used subtopics | Preserves historical quizzes while excluding removed scope from future generation |
| Timer | Client-side countdown | Practice mode does not require server-side enforcement |
