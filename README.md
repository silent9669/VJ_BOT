# VJBot · Sổ tay tiếng Nhật

[VJBot](https://vjbot.dangphuc.me/) is a Vietnamese learning interface for Japanese, with a sketch notebook design and an illustrated **thầy Lâm**, wearing a blazer ([Avataaars attribution](static/assets/lam/ATTRIBUTION.md)).

## Development status

The compact interface and expanded resource catalog are verified locally. Merges to `main` run the test suite and deploy through GitHub Actions. See the [handoff](docs/HANDOFF.md) for verification and scope.

## Learning

- Sign in or register from the public landing, then choose N5–N1, open one of 40 grammar chapters or 20 authored situations with Vietnamese explanations, 60 contextual questions and saved written responses. Reversible completion across lessons/Kaiwa/tests and lesson-grounded reversed chat. Crawled catalogs link 111 JLPT workbook resources (2012/2018), 225 Erin activities across 25 lessons, and 72 official Irodori lessons to publisher materials; the full dictionary library remains available.

- Vocabulary, grammar and kanji across N5–N1, loaded on demand by level, plus 20 original kana lessons.
- **10,720 imported OpenJLPT entries:** 7,811 vocabulary, 526 grammar patterns and 2,383 kanji records. Level assignments are community estimates, not official JLPT lists.
- Existing Vietnamese lessons plus clearly marked English definitions and examples from OpenJLPT. English material has not been represented as a Vietnamese translation.
- Recognition drills for every imported word and kanji, grammar meaning checks, source-linked sentence reading and synthetic-audio transcription practice. Example sentence difficulty may exceed the target word's level.
- Twenty-card review sessions, prioritizing due cards, with SM-2 scheduling for accounts. Learning routes require an account.
- Short JLPT-style quizzes with explanations. These are practice sets, not full official mock exams or certification scores.
- Kaiwa accepts typed Japanese or browser speech recognition. AI evaluates the transcript, not pronunciation from audio.

## Teacher and interface

The public page contains account entry only. The dashboard opens the next unfinished lesson and shows progress and practice tools. The desktop sidebar has an internal expand/collapse control; chat fills the available workspace. The 3D classroom and computer anatomy activities have been removed. The frontend remains HTML, CSS and JavaScript.

Roadmaps contain theory, vocabulary and grammar (including introductory kana). Tests and timed workbooks stay in Practice; writing lessons remain available in the library and through saved links. Chat supports multiline input (Shift+Enter), retry/discard and persisted request identities for safe retries.

## Accounts and AI

Email/password registration is also available. Passwords use salted scrypt (N=16384, r=8, p=5); login limits are 10 attempts per IP/email pair and 100 per IP per 15-minute bucket. Email accounts are independent of Google accounts. Email verification and password recovery are not implemented.

Google Identity Services returns an ID token that the Worker verifies against Google's public keys, issuer, audience, expiry and a cookie-bound nonce. Sessions use random tokens in HttpOnly cookies; only token hashes are stored in D1. Private APIs derive account ownership from the session, ignoring client-supplied user IDs.

Gemini 3.5 Flash chat and Kaiwa evaluation, and Gemini 3.8 Flash TTS, require login. Provider credentials are Worker secrets and are never shipped to the browser. Chat uses recent history and lesson text when launched from a lesson. AI failures are shown explicitly; there are no fabricated assessment scores. Requests are limited to 20 AI calls per account per minute.

Required Worker secrets: `GEMINI_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. The current ID-token flow uses the client ID and public keys; it does not exchange an authorization code or consume the client secret. Add `https://vjbot.dangphuc.me` to the OAuth client's authorized JavaScript origins. Local Google login also requires `http://localhost:8787` as an authorized origin.

Account deletion removes that account's credentials, profile, sessions, conversations and progress. [Data sources and privacy](https://vjbot.dangphuc.me/sources.html).

## Develop and verify

```sh
npm ci
npm run dev
npm test
npm run test:python
npm run build
```

The Worker uses a `gcp:us-east4` placement hint because Google rejected TTS requests from the default execution location. Placement is a routing hint, not a data-residency guarantee.

The production app is `src/worker.js` plus `static/`, deployed as the **vjbot** Worker with D1. Local Worker development uses port 8787. The Python backend remains a separate implementation and its tests do not prove deployed Worker behavior. Node 22.13+ is required for the Worker tests' SQLite adapter.

`npm run build` performs a Cloudflare dry run. `npm run deploy` deploys the Worker; apply migrations first. Vite's warnings about classic script tags are expected: those files are copied from the public asset directory and loaded in dependency order.

## Refresh publisher catalogs

```sh
python3 scripts/crawl_course_sources.py
python3 scripts/crawl_erin_resources.py
python3 scripts/crawl_jlpt_resources.py
```

These bounded crawls update metadata, publisher links, retrieval dates and source hashes. They do not mirror copyrighted PDFs, video, transcripts or audio. JLPT and Erin reject incomplete indexes before replacing their catalogs. Workbook documents, answer links and audio remain separated by year and level.

## Refresh lesson data

```sh
npm run data:import
npx cf d1 migrations apply <database-id> --dir migrations
python3 scripts/upload_lessons.py
npm run deploy
```

The importer pins OpenJLPT revision `0d1d3410bec90bd4098a7c72de820543cb4f707c` and records SHA-256 checksums in `static/openjlpt/manifest.json`. Review a new source revision and run the dataset tests before updating that pin. Uploads are idempotent and retain existing learner records.

Contains data from **OpenJLPT** (CC BY-SA 4.0), using JMdict and KANJIDIC2 (EDRDG), Jonathan Waller's JLPT lists and Tatoeba. The imported and derived lesson datasets retain **CC BY-SA 4.0** terms. See [full attribution](static/openjlpt/NOTICE.md) and [license](static/openjlpt/LICENSE). Tatoeba sentence links identify the source and contributors.

The [documentation index](docs/README.md) links the current architecture, API, deployment runbook and outstanding verification work.
