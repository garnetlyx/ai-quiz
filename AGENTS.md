# AI Quiz - Agent Instructions

## Project Overview

AI Quiz is an exam prep web app that generates realistic practice questions via AI. See [docs/PRD.md](docs/PRD.md) for full requirements.

## Tech Stack

- Frontend: React Native (Expo) with Expo Router — web-first
- Backend: Node.js (Fastify)
- Database: PostgreSQL with Drizzle ORM
- AI: OpenAI-compatible API protocol
- Auth: Email/password with JWT

## Key Conventions

- All code and comments in English
- LF line endings only
- Commit messages: imperative mood, under 72 characters
- Use `TODO:`, `FIXME:`, `HACK:` with context for code annotations

## Directory Structure

```
ai-quiz/
├── apps/
│   ├── web/          # Expo web app
│   └── api/          # Fastify backend
├── packages/
│   └── shared/       # Shared types and utilities
├── docs/             # Documentation
└── docker-compose.yml
```

## Development Guidelines

- Test-driven: write failing tests before implementation
- Security-first: validate all user inputs, parameterized queries only
- AI prompts live in `apps/api/src/prompts/` as versioned templates
- Environment config via `.env` files (never commit secrets)

## Material Question Bank

The system supports **unlimited question banks** from multiple sources:

1. **Verified material banks** in `data/<agent>/material-questions.json` — human-curated, extracted from textbooks/PDFs, ready for quiz generation
2. **AI-generated questions** — the quiz service can derive new questions from existing banks and web search context (Exa primary, SearXNG/Brave fallback), adapting difficulty and format to the user's performance
3. **Web-enriched questions** — AI can supplement material questions with current information from web search

After registration, users select a topic to start practicing. The system draws from the material bank first, then generates AI-derived questions to fill gaps and adapt to the user's weak areas. Material banks are seed data, not a ceiling.

Question statuses (material banks only):
- `ready` / `auto_repaired` / `web_verified` / `pdf_verified` / `user_verified` — all usable
- `discarded` / `needs_repair` — should not appear in production

## Project Skills

- **pdf-extraction**: Dual-column PDF extraction & repair. Auto-handles the common OCR corruption patterns when extracting exam questions from dual-column PDFs (questions left / answers right). See `.opencode/skills/pdf-extraction/SKILL.md`.
