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
