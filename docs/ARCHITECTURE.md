# AI Quiz - Architecture

## Overview

Monorepo with two apps (web frontend + API backend) and a shared package for types. The frontend is an Expo (React Native) web app; the backend is a Fastify server exposing a REST API that orchestrates AI question generation, web search verification, and data persistence.

## Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Frontend | React Native (Expo) + Expo Router | Web-first with future iOS/Android adaptation |
| Backend | Node.js + Fastify | Fast, schema-based validation, TypeScript-native |
| Database | PostgreSQL + Drizzle ORM | Relational model fits domain; Drizzle is type-safe and lightweight |
| AI | OpenAI-compatible SDK | Configurable endpoint supports local models, OpenAI, Claude proxies |
| Search | SearXNG + Brave Search API fallback | Local-first optional fact-checking for generated questions |
| Auth | bcrypt + JWT | Simple, stateless auth for MVP |
| Monorepo | npm workspaces | Lightweight, no extra tooling |

## Directory Structure

```
ai-quiz/
├── apps/
│   ├── web/                      # Expo web app
│   │   ├── app/                  # Expo Router pages
│   │   │   ├── (auth)/           # Login, register screens
│   │   │   ├── (app)/            # Authenticated screens
│   │   │   │   ├── dashboard.tsx
│   │   │   │   ├── topic/[id].tsx
│   │   │   │   ├── quiz/[id].tsx
│   │   │   │   └── results/[id].tsx
│   │   │   └── _layout.tsx
│   │   ├── components/           # Reusable UI components
│   │   ├── hooks/                # Custom React hooks
│   │   ├── services/             # API client
│   │   └── stores/               # Client state (zustand)
│   │
│   └── api/                      # Fastify backend
│       ├── src/
│       │   ├── routes/           # Route handlers
│       │   │   ├── auth.ts
│       │   │   ├── topics.ts
│       │   │   ├── quiz.ts
│       │   │   └── history.ts
│       │   ├── services/         # Business logic
│       │   │   ├── ai.ts         # AI client + prompt orchestration
│       │   │   ├── search.ts     # SearXNG primary + Brave fallback
│       │   │   └── quiz.ts       # Quiz generation + dedup logic
│       │   ├── prompts/          # Versioned AI prompt templates
│       │   │   ├── topic-interpret.ts
│       │   │   ├── format-detect.ts
│       │   │   └── question-generate.ts
│       │   ├── db/
│       │   │   ├── schema.ts     # Drizzle schema
│       │   │   └── migrations/
│       │   ├── middleware/        # Auth, validation
│       │   └── index.ts          # Server entry
│       └── tests/
│
├── packages/
│   └── shared/                   # Shared TypeScript types
│       └── src/
│           └── types.ts
│
├── docs/
│   ├── PRD.md
│   ├── ARCHITECTURE.md
│   ├── TASKS.md
│   └── SESSION_LOG.md
│
├── docker-compose.yml            # PostgreSQL for local dev
├── package.json                  # Workspace root
└── tsconfig.base.json
```

## Core Components

### 1. Topic Interpretation Pipeline

```
User input (free text)
  → AI: Interpret topic + detect ambiguity
  → If ambiguous: return clarification request
  → AI: Detect exam format (choices count, single/multi)
  → Present format for user confirmation
  → If rejected: user provides feedback → AI refines (+ web search) → re-confirm
  → AI proposes editable chapter/subtopic scope
  → User can edit description, scope, examples, notes, and additional topics
  → Save topic with confirmed format and scope
```

### 2. Question Generation Pipeline

```
Topic + format + active scope + supplemental materials + existing hashes
  → AI: Generate N questions with subtopic tags + explanations
  → Assign questions across active scope items to avoid uneven coverage
  → Deduplicate against question pool (content_hash)
  → Optional: SearXNG verification per question, Brave fallback
  → Store questions with content_hash
  → Return to client
```

### 3. Quiz Flow

```
Client requests quiz → API generates questions → Client presents one-by-one
  → User answers each → Client collects answers locally
  → User submits all → API scores, stores results
  → API returns summary with explanations
```

### 4. Weak Subtopic Tracking

```
On quiz completion:
  → Aggregate missed question subtopic_tags per topic
  → Update weak subtopics ranking
  → User can request quiz filtered by weak subtopics
  → Generation pipeline receives subtopic filter
```

## API Design

### Auth
- `POST /api/auth/register` — Create account
- `POST /api/auth/login` — Get JWT token

### Topics
- `POST /api/topics` — Create topic (triggers AI interpretation)
- `POST /api/topics/:id/confirm-format` — Confirm or reject detected format
- `GET /api/topics` — List user's topics
- `GET /api/topics/:id` — Topic detail with stats
- `PATCH /api/topics/:id` — Edit description, scope, examples, notes, and additional topics

### Quiz
- `POST /api/topics/:id/quiz` — Start quiz (generates questions)
- `POST /api/quiz/:id/submit` — Submit answers, get scored results
- `GET /api/quiz/:id` — Get quiz details/results
- `POST /api/quiz/:id/questions/:qid/flag` — Flag a question

### History
- `GET /api/topics/:id/history` — Quiz sessions for a topic
- `GET /api/topics/:id/missed` — Missed questions set
- `GET /api/topics/:id/weak-subtopics` — Weak subtopics ranking

## Data Flow

```
┌─────────┐     REST      ┌─────────┐     OAI API    ┌──────────┐
│  Expo   │ ◄──────────► │ Fastify │ ◄────────────► │ AI Model │
│  Web    │               │   API   │                 └──────────┘
└─────────┘               │         │ SearXNG/Brave   ┌──────────┐
                          │         │ ◄────────────► │  Search  │
                          │         │                 └──────────┘
                          │         │                 ┌──────────┐
                          │         │ ◄────────────► │ Postgres │
                          └─────────┘                 └──────────┘
```

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Monorepo | npm workspaces | Shared types, simple setup, no extra tooling |
| ORM | Drizzle | Type-safe, lightweight, good migration story |
| State management | Zustand | Minimal boilerplate for React Native |
| AI prompt storage | Code files in `prompts/` | Version-controlled, easy to iterate |
| Content dedup | SHA-256 hash of normalized question text | Fast lookup, handles minor variations |
| Question pool | Per-topic in DB | Scales with usage, queryable |
| Timer | Client-side countdown | No server enforcement needed for practice |
| Scope edits | Freeze removed used subtopics | Preserves historical quizzes while excluding removed scope from future generation |
