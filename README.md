# AI Quiz

AI-powered exam prep web app. Users describe their target exam in plain text, and AI generates realistic practice questions with detailed explanations. Tracks performance, identifies weak subtopics, and enables targeted practice.

## Features

- Free-text exam topic input with AI clarification
- Authentic question generation matching real exam formats
- Per-option explanations (why each choice is right/wrong)
- Optional web search verification (Brave API)
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

3. Start PostgreSQL:
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

### Testing
```bash
npm run test --workspace=apps/api
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for technical details.

## License

TBD
