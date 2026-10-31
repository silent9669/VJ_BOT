# Implemented features and limits

## Guided learning and review sets

The roadmap has 20 original practical units: N5 (6), N4 (5), N3 (4), N2 (3), N1 (2). Each has a concrete goal, suggested prerequisite order, six selected words, an original Japanese situation with Vietnamese translation, three contextual questions, and a written task with a model and three self-assessment criteria. N5 includes optional kana foundations outside the main progress total.

Each unit has a three-question contextual review. Versioned IDs preserve old history without transferring completion from the previous mechanically grouped roadmap. The latest answer must be correct for objective steps to pass. Written production is explicitly self-assessed, stores the answer text, and does not certify proficiency. The next unfinished main step opens from “Học tiếp”.

The public sources catalog filters 72 official Irodori lessons by book and title. It links original PDFs and audio pages; the crawl indexes 1,373 MP3 links without mirroring copyrighted content. Irodori A1/A2/A2–B1 is not an official N5–N1 mapping. Advanced units are short skill exercises, not complete exam passages. Authored content still needs human editorial review.

Lesson and quiz saves offer retry after failure. Optional attempt IDs prevent repeated save requests from incrementing counters twice. Guest receipts retain the last 100 attempts per item; signed-in receipts are stored in D1 and removed on account deletion.

## Lessons

- N5–N1 vocabulary, grammar and kanji, loaded once per selected level.
- 10,720 imported OpenJLPT records: 7,811 vocabulary, 526 grammar and 2,383 kanji. Production D1 contains 10,983 items: those records, 63 existing records and 200 practical-course identities.
- 20 original kana lessons cover 46 hiragana and 46 katakana. These are frontend lessons, not an additional 92 imported D1 entries.
- Expandable vocabulary/kanji details, readings, examples, furigana, radicals, stroke counts and related words where provided.
- Recognition drills for imported words/kanji and meaning checks for grammar. Exercises show one question at a time, feedback and final score.
- Attributed sentence reading and listening transcription. Listening is self-rated after revealing the transcript.
- Search and level/skill filters, 24-card initial page, load-more and keyboard-accessible detail dialogs.

OpenJLPT definitions are English and marked EN; existing Vietnamese lessons remain. Community level assignments are not official JLPT lists. Sentence difficulty may exceed the word's assigned level. Entries, generated lesson groups and authored lessons are distinct counts.

## Practice and AI

Flashcards use 20-card sessions prioritized by due dates. Signed-in progress uses SM-2 scheduling with repetitions reset after a miss; guests use local storage and simpler scheduling. Short JLPT-style quiz sets provide answer explanations; they are not complete official mock exams.

Authenticated chat uses thầy Lâm and saved conversation context. Lessons can pass context into practice. Kaiwa accepts typing or browser speech transcription and evaluates the transcript. No claim of pronunciation analysis is made. Japanese audio uses server-side TTS or browser speech fallback, subject to browser voices/support.

## Accounts

Google sign-in is implemented, with D1 profiles, sessions, conversations and progress. Account deletion targets the authenticated account's records. Guests can study locally; guest history is not automatically transferred to an account. Real Google consent and cross-browser persistence still need the verification listed in [HANDOFF.md](HANDOFF.md).

## Interface

Warm paper, sketch rules, restrained colors, mobile navigation and one consistent male teacher Lâm in a vest. The Three.js classroom supports object selection, spatial Japanese phrases, viewpoint adjustment and a four-object quiz. Keyboard controls and reduced-motion support accompany visual interactions. The computer anatomy figure is optional vocabulary content.

## Source licensing

Dataset revision: `0d1d3410bec90bd4098a7c72de820543cb4f707c` from `evanclan/OpenJLPT`. Imported/derived data retains CC BY-SA 4.0 terms. See [NOTICE](../static/openjlpt/NOTICE.md), [LICENSE](../static/openjlpt/LICENSE), [manifest](../static/openjlpt/manifest.json) and the public [sources page](https://vjbot.dangphuc.me/sources.html).
