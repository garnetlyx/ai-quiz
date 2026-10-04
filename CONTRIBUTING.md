# Contributing to AI Quiz

Thanks for your interest in contributing!

## Development Setup

1. Prerequisites: Node.js 20+, Docker, and an OpenAI-compatible API key.
2. Clone and install:

   ```bash
   npm install
   ```

3. Copy environment config and fill in your keys:

   ```bash
   cp .env.example .env
   ```

4. Start PostgreSQL and SearXNG:

   ```bash
   docker compose up -d
   ```

5. Push the database schema:

   ```bash
   npm run db:push --workspace=apps/api
   ```

6. Start development servers:

   ```bash
   npm run dev:api   # Terminal 1: Fastify API on :3001
   npm run dev:web   # Terminal 2: Expo web app on :8081
   ```

## Testing

```bash
npm test          # all workspaces
npm run typecheck # TypeScript for all workspaces
```

API tests run against a separate `<configured database>_test` database on the
same server (created and migrated automatically, emptied at the start of each
run), so they never touch development data. Tests that scan the private
`data/wa-agent/` material bank are skipped automatically when those files are
absent.

Write failing tests before fixing bugs or adding features.

## Code Style

- All code and comments in English
- LF line endings only
- Follow the existing structure: `apps/api` (Fastify backend), `apps/web`
  (Expo frontend), `packages/shared` (shared types)
- AI prompts live in `apps/api/src/prompts/` as versioned templates
- Security-first: validate all user inputs, parameterized queries only
- Use `TODO:`, `FIXME:`, `HACK:` with context for code annotations

## Commit Messages

- Imperative mood, under 72 characters
- Examples: `fix quiz question order stability`, `add weak-subtopic practice`

## Pull Requests

1. Fork the repo and create a branch from `main`.
2. Make your changes with tests.
3. Ensure `npm test` and `npm run typecheck` pass locally (CI runs both).
4. Open a pull request describing what changed and why.

## Reporting Issues

Use the issue templates on GitHub. Include reproduction steps, expected
behavior, and actual behavior. For security vulnerabilities, see
[SECURITY.md](SECURITY.md) — do not open public issues for them.
