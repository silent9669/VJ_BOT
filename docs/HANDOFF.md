# Development handoff

## Level shelves and routed lesson pages

- Curriculum navigation opens five illustrated level cards first. Each links to `#curriculum/N5` (through N1); library skills use `#curriculum/N5/library/reading`; lessons use `#curriculum/N5/lesson/grammar/<encoded-id>`.
- Lessons are full pages with breadcrumbs, practice, completion and next-lesson actions. Root opens landing; explicit course/lesson URLs now survive reload and browser Back/Forward. This supersedes the historical always-reset-to-landing behavior. Route loading is guarded against stale responses.
- Desktop sidebar defaults to a 76px icon rail; expansion preference persists locally. Mobile drawer supports Escape, focus containment, inert background and closing before the profile-level picker opens. Source navigation remains available in the expanded sidebar.
- Five original SVG course illustrations are under `static/assets/courses/`. Existing vanilla stack, teacher Lâm and Worker credentials remain in place; no runtime dependency added.
- Verification: 31 Node tests and 46 Python tests; browser checks for card→course→lesson, deep-link reload, Back/Forward, completion returning to roadmap, production lesson→course, desktop expansion persistence, mobile level picker, and 320/390/1440px layouts. No console errors in inspected routes. Real Google consent remains unverified.

## Guided practice and official video resources

- Lessons now separate reference material from practice. Select an answer, confirm with Kiểm tra, then continue after saving. Stable attempt IDs survive save retries; failed saves cannot advance the session. Written production and dictation retain their existing controls.
- Results show the first-pass score. Missed-question review uses the original item IDs and a separate score; completion remains a reversible learner action. Current chapter opens by default; optional kana does not override the required-course continue action.
- `scripts/crawl_erin_resources.py` indexes 25 Japan Foundation Erin lessons / 100 activity links with retrieval time and page SHA256. Available under N5/N4 supplemental video resources and `/sources.html`; no official JLPT equivalence or exhaustive syllabus claim. Videos, transcripts and exercises stay at the publisher. The 58 official JLPT links were refreshed unchanged.
- Motion uses CSS adaptations of Animate UI reveal/choice tokens, with reduced-motion overrides and native keyboard radio behavior. No React migration or extra runtime dependency.
- Verification: 26 Node tests, 46 Python tests and Worker build. Chrome: full five-question lesson (4/5), review of one missed question (1/1), manual completion, landing on reload, N1 practice, 390px mobile and desktop. Isolated browser retry fixture simulated a failed then successful save: same attempt ID and response, stale error cleared. Real Google consent remains unverified.

## Level learning and merge pass

This section supersedes the historical snapshots below. The user authorized merging to main and continuing deployment.

- Landing always opens first, including reloads of tab hashes; level buttons open the chapter list. Explicit navigation after opening works normally.
- 40 curated grammar chapters reference 163 pinned OpenJLPT patterns across N5–N1; 20 practical units now connect five activities including Kaiwa and tests. Original full reference library remains available.
- Official JLPT crawl adds 58 workbook/PDF/audio links across all levels. Run `python3 scripts/crawl_jlpt_resources.py` to refresh. OpenJLPT import was re-fetched at its pinned revision and remained unchanged. Publisher materials are linked externally, not copied.
- Migration 0007 adds private, reversible completion independent of scores and SRS. Shared completion UI covers lessons, Kaiwa, finished tests, chapters and lesson-linked reversed chat. Migration applied locally and to production; CI applies migrations before deploying.
- Reversed chat sends the selected level and actual bounded lesson material, including reading/listening passages. The Worker system instruction asks one question, waits for the learner, then gives feedback. Shared API credentials remain Worker secrets.
- Fixed legacy test IDs colliding across levels. No historical completion is inferred from ambiguous old exam IDs.
- 24 Node tests and 46 Python tests passed (two Python dependency deprecation warnings). Build passed. Read-only multi-model review found the identity/context issues above; both fixed with regressions. Browser checks verified landing-first routing, N1 list, lesson completion reflected in roadmap, and contextual Kaiwa on mobile.

The current course is a working study sequence, not a claim of exhaustive official JLPT coverage. Source grammar definitions are English; original Vietnamese practical content needs teacher review. Real Google consent remains unverified; authenticated API checks use isolated temporary QA sessions.

## Historical handoff — 2026-10-31

## Current practical curriculum pass

This section supersedes the historical status below. Deployed Worker: `2c217bd1-7be2-4a59-a423-da16076632da` at https://vjbot.dangphuc.me/.

- Replaced mechanical array-group roadmaps with 20 authored real-life units: six N5, five N4, four N3, three N2 and two N1. Each has a goal, suggested prerequisites, six selected words, original context with Vietnamese translation, three comprehension questions, and a written task/model/rubric.
- `static/course/practical.json` is the editable source. Do not rerun the temporary generation script; it predates content corrections. Versioned IDs prevent accidental transfer of old completion to new tasks.
- `scripts/crawl_course_sources.py` indexes all 72 Irodori lessons in four books and 1,373 original MP3 links, with HTML SHA256 and retrieval timestamps. It rejects incomplete book coverage. PDFs, transcripts and audio are not mirrored. `/sources.html` exposes book/search filters and original PDF/audio pages.
- No official Irodori-to-JLPT mapping is claimed. N2/N1 units are short skill practice, not complete exam preparation. All newly authored content still needs human editorial review.
- Three roadmap steps: selected words, contextual comprehension, written production. Objective completion requires the latest answer to be correct. Writing explicitly uses self-assessment, with persisted text and a 4,000-character limit. Optional kana is outside the main progress total.
- Migration 0006 adds latest correctness and written text, on top of existing idempotency receipts. The importer upserts 20 units/200 practice identities and preserves learner history. Production target: 10,983 curriculum items.
- 19 Node tests pass. Build and diff checks pass. Browser verified mobile wrong-answer review state, written answer restoration after reload, source filtering, and desktop contextual review feedback. No horizontal overflow at 390px/1440px in the inspected views; no console warnings/errors. Eight official PDF/audio samples across four books returned HTTP 200.
- Migration 0006 applied locally and in production; the course importer completed. Live D1/API checks verified written text across two sessions, latest correctness, retry deduplication, account isolation and account deletion. Temporary QA rows were removed.
- Removed unsupported “official format”/textbook-standard claims from the legacy short quiz titles.

Changes remain uncommitted. Real Google consent is still unverified. Preserve previous work; do not claim exhaustive feature coverage.

## Historical compact roadmap pass (superseded)

Worker `d4933bcf-41fb-401d-a620-c8411ce48666` introduced compact layout, saved-answer retry receipts, and mechanical recognition sets. Those sets have now been replaced by the practical curriculum described above. Existing progress remains in storage.

## Historical persistence pass

The user explicitly resumed development. The latest deployed Worker version is `e73fa75b-da1d-427c-8b62-e8f3e659a2ce` at https://vjbot.dangphuc.me/.

This persistence pass completed:

- Migration `0004_progress_display.sql` applied locally and to production. New generated-exercise answers retain readable labels per account; curriculum display text remains canonical. Existing unlabeled records acquire labels on their next labeled answer.
- Google login configuration/nonce now loads when the dialog opens and refreshes on reopening or rejected credentials. Expired sessions offer sign-in again, and failed session checks block writes instead of silently treating the learner as a guest. Failed logout remains visible.
- Initial page routing now waits for account/profile loading. Profile level changes update the page only after saving and show failure feedback.
- 16 Node tests pass; build, deploy and diff checks pass. Local and production browser reloads restored N4 flashcards. The production page was also reviewed at 390px with reduced motion; the Google button and flashcard page had no console errors.
- Live production checks with temporary sessions verified shared profile/progress/history across two sessions, account isolation, readable labels directly in D1, and account deletion invalidating both sessions. All temporary QA records were removed. These are authenticated API checks, not a completed Google consent flow or a full two-browser UI test.

The remaining work is real Google user sign-in verification, exercise save retry behavior, content quality, and reviewing/saving the uncommitted working tree. Do not repeat completed label, nonce-on-open or startup-order fixes from the historical list below. No commit, push or hosted CI run has been made.

## Earlier pause snapshot

The following sections record the state before resuming; the current status above supersedes their version, test count and completed-work list.

## Deployment and workspace

| Item | Recorded state |
| --- | --- |
| Workspace | `/Users/phucdang/Documents/VJ_BOT` |
| Branch | `chore/update-readme-and-descriptions` |
| Committed HEAD before this work | `2e8cef9` |
| Latest deployed Worker version | `98ed8739-6f47-4129-a757-22d88872523a` |
| Worker | `vjbot` |
| D1 binding | `DB` |
| D1 ID | `eb0d49a5-7a90-4219-968c-5fcb04390859` |
| Config | `cloudflare.config.ts` |
| Execution placement hint | `gcp:us-east4` |

The app, imported dataset, migrations, tests, workflow changes and documentation are **uncommitted in the working tree**. No branch switch, commit, push, PR or merge was performed for this work. Preserve this state before reorganizing commits; inspect `git status` rather than assuming every change was made in the final pass.

The final app refinements were deployed successfully. Documentation and workflow edits are local repository changes; hosted CI has not been run for this working tree. No deployment was performed after the stop request. The local development server and the two temporary live-tail sessions were stopped.

The local server log reported missing local `GEMINI_API_KEY` and `GOOGLE_CLIENT_SECRET` configuration on a restart. Production secret bindings are separate and were configured; set up ignored local credentials before expecting local authenticated AI to work.

## Implemented

- Google ID-token verification and D1 sessions; account-scoped profile, chat history, progress and deletion.
- Worker-only Gemini credentials, authenticated chat/Kaiwa/TTS and per-account AI request limits.
- 10,720 pinned OpenJLPT entries plus 63 existing D1 entries. The frontend also builds 20 kana lessons covering 92 basic characters.
- Vocabulary and kanji recognition exercises, grammar checks, sentence reading, listening transcription, flashcards and short JLPT-style quizzes.
- Sketch notebook layout, mobile navigation, searchable lesson library with 24-card paging and native lesson dialogs.
- Consistent male pixel teacher Lâm in a vest; interactive Three.js classroom with accessible object controls and a four-object quiz.
- Reduced motion, keyboard controls, explicit save/provider failure messages and removal of fabricated AI assessments.

See [Features](FEATURES.md) for content qualifications and [Architecture](ARCHITECTURE.md) for the static lesson/D1 split.

## Verification evidence and limits

- Latest Node run: 10/10 tests passed, covering lesson integrity, exercises, session protection, ownership, SRS reset, deletion isolation, rate limits and TTS response handling.
- Earlier in this work: 46 Python tests passed with two dependency deprecation warnings. This checks the separate Python implementation.
- Production build, final deploy, `git diff --check` and source credential-pattern scan passed.
- Browser: desktop lessons/chat/flashcards/quiz reviewed; 390px mobile library had no horizontal overflow. Paging changed 24 to 48 visible cards with no nested buttons. Reduced-motion emulation was enabled.
- Live browser console had no warnings/errors at the last inspection.
- Live `/api/health` returned `status: ok`, `app: vjbot`, `d1_items: 10783` after the final deployment.
- Live D1 table listing confirmed profiles, sessions, curriculum tables, progress, conversations, study_days, ai_usage and migration tracking.
- Earlier production API checks used short-lived synthetic QA sessions: chat and Kaiwa returned actual AI output; TTS returned audio after the placement change. QA records were removed. These checks did **not** exercise Google's user consent flow.
- Actual Google login, persistent progress across two real browser sessions, and the final classroom quiz changes have not all been verified end-to-end on the final deployment. Local quiz selection was checked; the final disabled-next change built and deployed.

## Next work when explicitly resumed

1. **Verify real Google sign-in.** Check the authorized JavaScript origin `https://vjbot.dangphuc.me`, sign in through the UI, reload, reopen from a second browser, and verify logout/account separation. Keep credentials out of logs and documents.
2. **Finish the production persistence audit.** With isolated QA accounts, change the level, answer a lesson and flashcard, chat, reload and verify the same data on a second session. Check D1 records and ensure another account cannot read or change them. Remove only QA records afterward.
3. **Preserve labels for generated exercises.** Confirmed source gap: progress saves IDs/counters but ignores the submitted display text. `/api/progress` joins `curriculum_items` for display text, so kana, classroom, exam and generated sentence IDs can appear as raw IDs or generic weak-spot labels. Add a narrowly scoped migration or metadata table, with a regression test. No fix has been started.
4. **Make delayed/repeated login reliable.** The nonce is created during page setup and expires after ten minutes. Opening Google login much later can fail; expired sessions currently instruct a reload. Refresh sign-in state deliberately and test expiry/network failures.
5. **Check startup data ordering.** Initial tab rendering happens before account/profile loading. A direct visit to flashcards/progress may initially use guest/default-level data. Reproduce before changing the initialization sequence.
6. **Review failed-save retry behavior.** Lesson exercises report save failure but can still advance. Add a clear retry path if reproducing this confirms lost progress. Profile changes also need a visible failed-save state.
7. **Review content quality.** English glosses are explicitly marked EN. Add reviewed Vietnamese explanations and richer exercises incrementally; do not describe imported entries as thousands of fully authored lessons or official JLPT coverage.
8. **Save and ship repository changes deliberately.** Review the existing dirty tree, split data/auth/UI/docs into coherent commits, then run required checks and hosted CI if publishing is requested. Deployment success does not establish GitHub CI success.

## Product constraints to preserve

Keep the existing vanilla HTML/CSS/JavaScript stack unless a migration is requested. Use warm paper, pencil-like rules, concise labels and restrained animation. Avoid marketing filler, repetitive cards and decorative helper text. Use one teacher, Lâm, male and wearing a vest. Motion must respect reduced-motion and the 3D scene must retain keyboard-accessible alternatives. Preserve OpenJLPT attribution and share-alike licensing. Do not add AI co-author trailers to commits.
