# AI Quiz

[![CI](https://github.com/garnetlyx/ai-quiz/actions/workflows/ci.yml/badge.svg)](https://github.com/garnetlyx/ai-quiz/actions/workflows/ci.yml)

AI-powered exam prep web app. Users describe their target exam in plain text, and AI generates realistic practice questions with detailed explanations. Tracks performance, identifies weak subtopics, and enables targeted practice.

## Features

- Free-text exam topic input with AI clarification
- Editable chapter/subtopic scope with supplemental materials
- Authentic question generation matching real exam formats
- Per-option explanations (why each choice is right/wrong)
- Optional web search verification (SearXNG primary, Brave fallback)
- Flashcard-style quiz flow with optional timer
- Missed questions tracking and retry
- Weak subtopic identification and targeted practice
- Quiz history and progress tracking

## Tech Stack

- **Frontend**: React Native (Expo) — web-first, mobile-adaptable
- **Backend**: Node.js
- **Database**: PostgreSQL
- **AI**: OpenAI-compatible API (configurable endpoint)

## Getting Started

### Prerequisites
- Node.js 20+
- Docker (for PostgreSQL)
- An OpenAI-compatible API key

### Setup

1. Clone and install:
   ```bash
   npm install
   ```

2. Copy environment config:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and set `OPENAI_API_KEY` and `JWT_SECRET`.

3. Start PostgreSQL and local SearXNG:
   ```bash
   docker compose up -d
   ```

4. Push database schema:
   ```bash
   npm run db:push --workspace=apps/api
   ```

5. Start development:
   ```bash
   # Terminal 1: API
   npm run dev:api

   # Terminal 2: Web
   npm run dev:web
   ```

### Tailscale access

To open the app from any device on your tailnet, run the API and web app on this
machine's Tailscale address:

```bash
scripts/tailnet.sh start     # or stop | restart | status
```

The API listens on the tailnet IP only (`HOST`), the web app on port 8081 and is
built against that API address. Logs are in `$TMPDIR/ai-quiz-tailnet/`.

### Testing
```bash
npm test
```

API tests run against a separate `<configured database>_test` on the same server
(created and migrated automatically, emptied at the start of each run), so they
never touch development data. Web tests cover its pure helpers.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for technical details and
[CONTRIBUTING.md](CONTRIBUTING.md) for the full development guide.

### Search

The API uses Exa MCP for web search and fact-check context when `EXA_API_KEY` is
set. If Exa is unavailable, `SEARXNG_BASE_URL` is used as a fallback (local
Docker exposes SearXNG at `http://localhost:8080`). If SearXNG also returns no
results and `BRAVE_API_KEY` is set, Brave Search is used as a final fallback.

## License

Released under the [MIT License](LICENSE).
