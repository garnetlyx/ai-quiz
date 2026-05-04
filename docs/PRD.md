# AI Quiz - Product Requirements Document

## 1. Overview

AI Quiz is a web application that helps exam candidates prepare for standardized multiple-choice exams by generating authentic, AI-powered practice questions. Users describe their target exam in plain text (e.g., "Real estate broker exam in California"), and the system generates realistic quiz questions with detailed explanations for every option. The app tracks performance across sessions, identifies weak subtopics, and enables targeted practice to maximize exam readiness.

## 2. Target Users

- **Primary**: Self-study learners preparing for standardized multiple-choice exams (professional licenses, academic tests, certifications)
- **Motivation**: Goal-oriented — focused on passing a specific exam, improving scores
- **Stage**: Active exam prep, typically in crunch mode
- **Examples**: Real estate broker candidates, GRE test-takers, driver's license applicants, professional certification seekers

## 3. Use Cases

### UC-1: Start a New Quiz Topic
User enters a free-text description of their target exam. AI interprets the scope and, if ambiguous, asks for clarification with suggestions (e.g., "What specific topic or subject would you like to practice?"). AI also detects the exam format (number of choices, single/multi-select) and presents it for user confirmation. If the user rejects, an optional textbox allows them to describe the correct format or what's wrong; the system uses this feedback (plus web search when configured) to improve and asks for review again. Once confirmed, the topic and format are saved to the user's account.

### UC-2: Take a Quiz
User selects a topic and sets the number of questions. Optionally enables a timer. Questions are presented one at a time (flashcard-style). User selects answer(s) and advances. At the end, a summary screen shows results.

### UC-3: Review Results
Summary screen displays: score, per-question breakdown with explanations for why each option is correct or incorrect. Missed questions are highlighted and tagged by subtopic.

### UC-4: Retry Missed Questions
User can retry only the questions they got wrong in a previous session, presented in the same flashcard-style flow.

### UC-5: Practice Weak Subtopics
System tracks missed subtopics across sessions. User can choose to generate a new quiz targeting their weakest subtopics specifically.

### UC-6: View History
User can browse past quiz sessions per topic, see scores over time, and review any past session's details.

## 4. Feature Scope

### Phase 1 — MVP

| Feature | Description |
|---------|-------------|
| **Free-text topic input** | User types exam description; AI interprets or asks for clarification |
| **AI question generation** | Generate realistic exam questions matching real exam format (number of choices, single vs. multiple select) |
| **Explanations** | Every option gets an explanation of why it is correct or incorrect |
| **Web search verification** | When Brave API is configured, verify question accuracy via web search; otherwise use model's knowledge |
| **Flashcard-style quiz flow** | One question at a time, answer and advance |
| **Optional timer** | User can enable/disable a countdown timer per quiz session |
| **Configurable question count** | User sets number of questions before starting |
| **Results summary** | Score, per-question breakdown, explanations |
| **Subtopic tagging** | AI assigns one or more subtopic tags to each generated question |
| **User accounts** | Email/password authentication |
| **Topic management** | Save, list, and select quiz topics per user |
| **Missed questions tracking** | Per-topic record of missed questions, retryable |
| **Weak subtopics tracking** | Aggregate missed subtopics; enable targeted practice |
| **Quiz history** | Per-topic session history with scores and details |
| **Exam format confirmation** | AI detects exam format and asks user to confirm; user can reject with feedback, triggering refinement via web search |
| **Flag question** | Users can flag individual questions as inaccurate/poorly worded; flagged questions are excluded from future sessions and logged for review |
| **Question deduplication** | Track generated question pool per topic; avoid repeating questions across sessions |

### Phase 2 — Future (Out of Scope for MVP)

- Syllabus/study guide upload (PDF, images)
- Difficulty adaptation based on performance
- Social features (leaderboards, sharing)
- Monetization / paid tiers
- Admin dashboard
- Content moderation
- iOS / Android native apps (architecture supports future adaptation)

## 5. UI/UX

### Screens

1. **Landing / Login**: Email/password auth
2. **Dashboard**: List of user's saved topics, quick-start new topic
3. **New Topic**: Free-text input with conversational AI clarification
4. **Quiz Setup**: Select topic, set question count, toggle timer
5. **Quiz Flow**: Flashcard-style — question, options, select, next; flag button on each question
6. **Results Summary**: Score, question-by-question review with explanations; flag button per question (also in answer review when user questions the AI explanation)
7. **Topic Detail**: History of sessions, missed questions set, weak subtopics
8. **Retry / Subtopic Practice**: Same quiz flow, filtered by missed or weak subtopic

### UX Principles

- Clean, distraction-free quiz interface
- Immediate visual feedback on answer selection (but no correctness reveal until summary)
- Mobile-responsive design (future native app via React Native)
- Conversational topic input — feels natural, not form-heavy

## 6. Technical Requirements

### Frontend
- **React Native (Expo)** — web-first, adaptable to iOS/Android later
- Expo Router for navigation
- Web deployment as primary target

### Backend
- **Node.js** (Express or Fastify)
- RESTful API

### Database
- **PostgreSQL** — relational data fits well (users, topics, questions, sessions, scores)

### AI Integration
- OpenAI-compatible API protocol
- Configurable base URL and API key (supports local models, OpenAI, Claude-compatible endpoints)
- Structured prompt engineering for:
  - Exam format detection (number of choices, single/multiple select)
  - Question generation with subtopic tags
  - Per-option explanations
  - Ambiguity detection and clarification requests

### Web Search (Optional)
- Brave Search API integration
- Used for fact-checking generated questions when API key is configured
- Graceful fallback to model-only generation when not configured

### Authentication
- Email/password with hashed passwords (bcrypt)
- JWT-based session management

## 7. Data Model (High-Level)

- **User**: id, email, password_hash, created_at
- **Topic**: id, user_id, title, description, exam_format (choices count, single/multi), created_at
- **QuizSession**: id, topic_id, question_count, timer_enabled, timer_duration, score, completed_at
- **Question**: id, session_id, topic_id, content, options (JSON), correct_answer(s), explanations (JSON), subtopic_tags[], user_answer, is_correct, is_flagged, flag_reason, content_hash (for deduplication)
- **MissedQuestionSet**: derived from Questions where is_correct=false, per topic
- **WeakSubtopics**: aggregated from missed question subtopic_tags, per topic
- **QuestionPool**: per-topic index of content_hash values to prevent duplicate generation across sessions

## 8. Constraints

- AI-generated questions may not be perfectly accurate — web search verification mitigates this
- OAI-compatible API must be pre-configured; no model hosting by the app itself
- No offline support in MVP
- Single-language (English) for MVP

## 9. Success Criteria

- Users can create a topic, take a quiz, and review results in under 2 minutes
- Generated questions are realistic and match the target exam format
- Weak subtopic tracking helps users focus study time
- Users return for multiple sessions (retention)
- Measurable: quizzes completed, daily active users, score improvement over time

## 10. Release Planning

| Milestone | Deliverable |
|-----------|-------------|
| M1 | Auth + Topic creation with AI clarification |
| M2 | Question generation + Quiz flow |
| M3 | Results, explanations, subtopic tagging |
| M4 | Missed questions, weak subtopics, retry flow |
| M5 | Quiz history, polish, deploy |
