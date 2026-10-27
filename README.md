# VJBot — Nihongo Sensei (日本語先生)

> **AI-Powered Reversed Japanese Classroom & JLPT N5–N1 Exam Simulator**  
> Live Production: [**https://vjbot.dangphuc.me/**](https://vjbot.dangphuc.me/)

[![CI/CD Pipeline](https://github.com/silent9669/VJ_BOT/actions/workflows/deploy.yml/badge.svg)](https://github.com/silent9669/VJ_BOT/actions/workflows/deploy.yml)
[![Edge Deployment](https://img.shields.io/badge/Deployment-Cloudflare%20Workers-orange)](https://vjbot.dangphuc.me/)
[![Database](https://img.shields.io/badge/Database-Cloudflare%20D1%20SQLite-blue)](https://developers.cloudflare.com/d1/)
[![LLM Model](https://img.shields.io/badge/LLM-Google%20Gemini%202.5%20Flash-green)](https://aistudio.google.com/)
[![Tests](https://img.shields.io/badge/Tests-46%20Passed-brightgreen)](tests/)

---

## 🌟 Overview

**VJBot** is a modern Japanese learning application designed with the **Reversed Classroom** pedagogy: instead of waiting passively for user prompts, **Sensei** proactively leads the learning journey, introduces JLPT topics, conducts voice drills, evaluates speech, and identifies weak grammar spots using the **SuperMemo-2 (SM-2)** spaced repetition algorithm.

The application combines **Apple Liquid Glass** design aesthetics with **8-bit retro pixel art**, featuring an interactive 1984 Macintosh retro PC with a real-time Japanese typewriter loop on the landing page.

---

## 🚀 Key Features

1. **Retro 1984 Macintosh Landing Page (`<anatomy-computer>`)**:
   - Interactive isometric 1984 Apple PC with mechanical keyboard and vintage coiled cable.
   - CRT green phosphor display running an infinite Japanese typewriter loop.
   - Apple-style bento grid showcasing curriculum highlights, Kaiwa speaking lab, and mock exam simulator.

2. **Proactive AI Classroom & Voice Assistant**:
   - Conversational tutor powered by **Google Gemini 2.5 Flash**.
   - Proactive questioning, grammar distinction explanations, and bilingual Vietnamese-Japanese guidance.
   - Natural voice output with multimodal Gemini TTS.

3. **Spawn Sensei Anywhere**:
   - Floating Mascot Dock available at the bottom-right corner across all tabs.
   - Global keyboard shortcut (`⌘K` / `Ctrl+K`) to summon Sensei instantly from anywhere.

4. **4-Skill JLPT Curriculum Roadmap (N5–N1)**:
   - Full competency tracks across **Vocabulary**, **Grammar**, **Reading**, and **Listening**.
   - Multi-tier breadcrumb navigation (`Lộ trình > Level > Kỹ năng > Bài học`).
   - In-depth lesson modals with formulas, audio pronunciation, and interactive drills.

5. **Authentic JLPT Mock Exam Simulator**:
   - International exam structure: **Mondai 1 (Kanji)**, **Mondai 2 (Vocab)**, **Mondai 3 (Grammar Star ★)**, **Mondai 4 (Reading Comprehension)**.
   - Available across all levels (**N5, N4, N3, N2, N1**) with test number selection (**Đề 01, Đề 02**).
   - Dynamic exam countdown timer (20 to 40 minutes) with instant grammatical explanations.

6. **Kaiwa Speaking Lab with Audio Playback**:
   - Voice recognition via native **Web Speech API** (`ja-JP`).
   - Integrated **MediaRecorder** audio capture: learners can click **"🎧 Nghe lại giọng bạn"** to review their pronunciation against Sensei's model audio.
   - AI evaluation with 0–100 scoring and actionable pronunciation feedback.

7. **Flashcards with SM-2 Spaced Repetition**:
   - 3D perspective flip cards with Kanji, Furigana, Vietnamese definitions, and audio examples.
   - 3-tier grading (Again, Good, Easy) dynamically adjusting review intervals in Cloudflare D1.

8. **Radar Mastery & Weak Spot Analytics**:
   - Real-time accuracy metrics and weak spot identification.
   - Instant "Ôn tập ngay" CTA to immediately launch tailored practice sessions with Sensei.

---

## 🛠️ Dual-Engine Architecture

| Component | Production Stack (Live) | Local / Docker Development Stack |
| :--- | :--- | :--- |
| **Hosting** | Cloudflare Workers (Global Edge) | FastAPI / Uvicorn Server |
| **Database** | Cloudflare D1 (Serverless SQLite) | MongoDB 7 (Async Motor driver) |
| **Domain** | `vjbot.dangphuc.me` | `http://localhost:8000/` |
| **Static Assets**| Cloudflare Static Asset Binding | Starlette StaticFiles |
| **AI LLM** | Google Gemini 2.5 Flash via REST | `google-genai` Python SDK |

---

## 📖 Deep-Dive Documentation Index

Comprehensive guides for teammates, developers, and architects are available in the [`docs/`](docs/) directory:

- 📄 [**Feature Specifications (`docs/FEATURES.md`)**](docs/FEATURES.md): Detailed specs for Standalone Landing Page, OAuth 2.0 architecture, Pixel Mascot system, Level & Test Card organization, 4-skill curriculum, and voice recording pipeline.
- 🏗️ [**System Architecture (`docs/ARCHITECTURE.md`)**](docs/ARCHITECTURE.md): Edge runtime architecture, Cloudflare D1 schemas (`profiles`, `progress`, `conversations`, `curriculum_items`), and SM-2 Spaced Repetition mathematics.
- 📡 [**API Reference (`docs/API_REFERENCE.md`)**](docs/API_REFERENCE.md): Full documentation of all REST/Edge API endpoints with request/response schemas.
- 🚀 [**Deployment & CI/CD (`docs/DEPLOYMENT_CICD.md`)**](docs/DEPLOYMENT_CICD.md): Cloudflare deployment commands, GitHub Actions workflow, and branch protection policy.
- 🤝 [**Contributor Guide (`docs/CONTRIBUTING.md`)**](docs/CONTRIBUTING.md): Onboarding instructions, local testing setup, and PR-only git workflow.

---

## ⚡ Quickstart

### 1. Run Tests Locally
```bash
# Set up Python virtual environment
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt pytest pytest-asyncio anyio httpx

# Run test suite (46 tests)
PYTHONPATH=. .venv/bin/pytest
```

### 2. Verify Cloudflare Edge Build
```bash
# Verify static asset bundling and Worker compatibility
npx cf deploy --dry-run
```

### 3. Deploy to Production
```bash
npx cf deploy
```

---

## 🔒 Security & Branch Protection

- The `main` branch is protected by GitHub Ruleset **#25958093**:
  - Direct pushes and force pushes are blocked.
  - All changes must be submitted via a Pull Request.
  - Merges require green status checks from the automated CI/CD pipeline (`Test & Quality Checks`).
