# Implemented features and limits

## Guided learning and review sets

Opening the app starts on the landing page. Choose N5–N1 to open a compact chapter list; expand a chapter, choose a lesson, and use the next-lesson action. The library retains all vocabulary, grammar, kanji, reading and listening groups.

The guided sequence has 40 curated grammar chapters (eight per level, 163 source pattern references) and 20 authored practical units (N5: 6, N4: 5, N3: 4, N2: 3, N1: 2). Each practical unit connects vocabulary, comprehension, written production, Kaiwa and its contextual test. Grammar source explanations remain English. This is an editorial learning sequence, not an official exhaustive JLPT syllabus.

Every lesson, Kaiwa prompt, finished test, roadmap chapter and lesson-linked reversed-chat activity has a reversible completion control. Completion is explicit learner bookkeeping, independent of exercise correctness, self-assessment and SM-2 scheduling. Account completions persist in D1; guest completions persist locally. The progress screen lists marked activities. Old answer records are preserved; ambiguous legacy exam IDs are not migrated into the new level-qualified identities.

The official resource crawl indexes 58 workbook links from JLPT for all five levels. Each level exposes vocabulary, grammar, reading and listening workbooks with original answer sheets, scripts and audio links. The Irodori catalog retains 72 lessons and 1,373 MP3 links. Copyrighted PDFs/audio remain on publisher servers; only link metadata is stored. Irodori levels are not official JLPT equivalents. Authored content still needs human editorial review.

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

Authenticated reversed chat uses thầy Lâm and saved conversation context. It asks the learner to explain or apply the selected material before offering correction and another question. Lesson context includes actual examples, passages or listening scripts, with an explicit selected level. Kaiwa accepts typing or browser speech transcription and evaluates the transcript. No claim of pronunciation analysis is made. Japanese audio uses server-side TTS or browser speech fallback, subject to browser voices/support.

## Accounts

Google sign-in is implemented, with D1 profiles, sessions, conversations and progress. Account deletion targets the authenticated account's records. Guests can study locally; guest history is not automatically transferred to an account. Real Google consent and cross-browser persistence still need the verification listed in [HANDOFF.md](HANDOFF.md).

## Interface

Warm paper, sketch rules, restrained colors, mobile navigation and one consistent male teacher Lâm in a vest. The Three.js classroom supports object selection, spatial Japanese phrases, viewpoint adjustment and a four-object quiz. Keyboard controls and reduced-motion support accompany visual interactions. The computer anatomy figure is optional vocabulary content.

## Source licensing

Dataset revision: `0d1d3410bec90bd4098a7c72de820543cb4f707c` from `evanclan/OpenJLPT`. Imported/derived data retains CC BY-SA 4.0 terms. See [NOTICE](../static/openjlpt/NOTICE.md), [LICENSE](../static/openjlpt/LICENSE), [manifest](../static/openjlpt/manifest.json) and the public [sources page](https://vjbot.dangphuc.me/sources.html).
