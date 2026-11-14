# Vietnamese localization inventory

## Scope and evidence

Requested on 2026-11-14: take over Vietnamese localization and first inspect everything requiring translation across every user-accessible feature. This checkpoint inventories work; it does not implement translations.

- Baseline: `204b55b8d994a36c4a5bceb77b62c7bb2f33014e`, the committed `origin/main` reference available locally. No remote refresh or production-version equivalence is claimed.
- Worktree: `C:/Users/TRI/VJ_BOT-vietnamese-audit`; branch: `docs/vietnamese-localization-audit`.
- Product scope: the Cloudflare Worker and static web application, public pages, learner routes, administrator routes, dialogs, generated exercises, accessibility names and error/recovery paths. The separate legacy Python application is not the deployed web surface inspected here.
- Source inventory: frontend entry points and renderers, all 22 direct `src/*.js` modules, all fifteen OpenJLPT files, course/resource/rubric JSON and translation/catalog builders. Source inspection covers conditional states; it is not an assertion that every conditional state was executed.
- Browser evidence: the baseline's real frontend in isolated Edge at `127.0.0.1:8894`, served by Python's static HTTP server. Authenticated views used intercepted, synthetic session/profile/empty-progress responses, not real authentication or D1. Static lesson data was not replaced. External Google/font requests were blocked. No real API key, provider generation, microphone access, permission grant, account mutation or production action was performed.
- Ownership: existing application files remain read-only. The canonical teaching-quality workstream retains its runtime/N5 ownership. No dirty work from the main checkout or another worktree was imported.

## Findings at a glance

1. The screenshot is reproducible in N3's first kanji lesson: `政` shows `politics; government`; its five-check practice shows four English meaning choices.
2. This is a shared data fallback, not one mistranslated label: `dict[text] || text` copies missing English into fields named `vi` and into generated answers/distractors.
3. The current dictionary has 807 keys. Across 29,317 distinct nonempty candidate source strings, 28,510 have no exact dictionary key. These are candidates for language/context review, not 28,510 independently adjudicated translation defects.
4. Missing localization also affects normal API/OAuth onboarding, storage/privacy and charging notices, read-aloud setup/playback, browser recording fallback and Kaiwa result/criterion text.
5. Optional AI teaching translates selected presentation on request. It does not make the corpus, search, saved activity titles or later sessions Vietnamese by default.
6. Vietnamese fallbacks do not cover nonempty English server `detail` or native `error.message`. Both server and browser-authored failures require inventory and consistent presentation.

## 1. What to translate, preserve and review

| Class | Policy |
|---|---|
| Interface prose | Vietnamese headings, labels, tooltips, placeholders, accessible names, help, empty/loading/success/failure states and confirmations. Update HTML and runtime replacements together. |
| Learning support | Vietnamese meanings, explanation, usage notes, instructions, contextual translations, feedback, criteria and prose answer choices. Keep these roles separate. |
| Japanese learning targets | Preserve Japanese words/sentences, kana, readings, furigana, conjugation symbols, submitted answers, exact cited learner evidence and Japanese answer options. Do not append a revealing translation to a reading/meaning target before an attempt. |
| Assessment identity | Preserve canonical IDs, original option positions/multiplicity, answer keys, verdict/action codes, attempt history and grading. Translated labels are not replacement grading values. |
| Provider/technical identity | Preserve OpenAI/Gemini/Claude/Antigravity, exact model IDs, URLs, API/protocol/schema identifiers, account identifiers and user-chosen names. Explain technical terms in Vietnamese without renaming their values. |
| Source/legal originals | Preserve original source bytes, hashes, attribution, licenses and publisher edition names. Add permitted Vietnamese presentation, not silent edits to pinned originals. Linked PDFs/audio/video are not automatically authorized translation/ingestion material. |
| Internal instructions | English system prompts, schemas, diagnostic `OK`, code comments and logs are not untranslated UI merely because they contain English. Review the output contract instead. |
| Uncertain language/sense | Review context. Latin letters, an existing exact dictionary hit or a property named `vi` do not establish language or semantic correctness. |

Suggested user-facing terminology: `Thầy Lâm`, `Luyện nói` for Kaiwa navigation, `Hán tự` for kanji navigation, `Trò chuyện trực tiếp` for continuous Voice, `Đọc thành tiếng` for read-aloud, `Chép lời` for transcription, and `Mô hình` for explanatory model labels. Keep exact model/provider names. This is a terminology proposal, not an applied change.

## 2. Measured learning-data coverage

### OpenJLPT inventory

`Candidate occurrences` counts nonempty strings in `meanings[]`, `meaning`, `notes` and `examples[].en`, including repeats. `Dictionary hits` counts occurrences with a truthy exact-key value in the merged dictionary, matching runtime fallback semantics.

| Level | Vocabulary records | Kanji records | Grammar records | Candidate occurrences | Dictionary hits | No dictionary hit |
|---|---:|---:|---:|---:|---:|---:|
| N5 | 674 | 84 | 81 | 2,739 | 175 | 2,564 |
| N4 | 630 | 169 | 98 | 3,008 | 162 | 2,846 |
| N3 | 1,659 | 387 | 101 | 9,531 | 165 | 9,366 |
| N2 | 1,778 | 398 | 123 | 8,954 | 154 | 8,800 |
| N1 | 3,070 | 1,345 | 123 | 17,602 | 162 | 17,440 |
| Total | 7,811 | 2,383 | 526 | 41,834 | 818 | 41,016 |

| Source kind | Candidate occurrences | Dictionary hits |
|---|---:|---:|
| Vocabulary meanings and example translations | 30,778 | 4 |
| Kanji meanings | 8,480 | 1 |
| Grammar meaning, notes and example translations | 2,576 | 813 |

Global deduplication: **29,317 unique candidates; 807 exact-key hits; 28,510 absent keys**. The dictionary has **807 entries**, all matching at least one candidate. `static/course/vi-dict.json` is absent; only `vi-grammar.json` is present. Exact-key presence and truthy runtime coverage agree in this snapshot. No fuzzy matching or sentence-level language certification was performed.

These totals exclude English terminology inside `formation`/`pattern`, resource titles, rubric labels, legacy JS-authored lessons, UI copy, server errors and generated AI prose. They are not counts of lessons, independent questions or confirmed bad translations. Different contexts can share one English key; an exact hit does not certify the correct sense.

### Fields and downstream surfaces

| Origin | Fields needing Vietnamese presentation/review | Where they reach learners |
|---|---|---|
| `openjlpt/vocab-n*.json` | `meanings[]`, `examples[].en` | Vocabulary cards, examples, meaning-choice exercises, flashcard backs, mixed quizzes, reading/listening sentence groups and teacher catalog. |
| `openjlpt/kanji-n*.json` | `meanings[]` | Kanji disclosures and generated meaning answer/distractor pools. Dedicated flashcards use vocabulary, not this kanji deck. |
| `openjlpt/grammar-n*.json` | `meaning`, `notes`, `examples[].en`; prose inside `formation` and English qualifiers in `pattern` | Grammar cards, structure guidance, examples, drills and canonical tutor evidence. |
| `course/vi-grammar.json` | Review existing Vietnamese values in context; retain exact source keys | Existing shared lookup path. Missing optional `vi-dict.json` is not a completed bulk translation. |
| `course/chapters.json` | Titles/goals already Vietnamese; review future visible note fields | Forty chapters, eight per level; roadmap cards and search. |
| `course/practical.json` | Title/goal/note, prose formula slots, words/dialogue translations, questions/prose options, explanations, writing prompt/criteria | Twenty practical units: N5=6, N4=5, N3=4, N2=3, N1=2. Inspected authored content is largely Vietnamese/Japanese. Preserve Japanese production model/question. |
| `jlpt-data.js` | Authored title/summary/meaning/explanation, word/example support, reading `translation`, listening `script_vi`, prompt hints, quiz instruction/explanation | Seed lessons, reading/listening/writing, original quizzes and Kaiwa scenarios. Largely Vietnamese; not all literals were independently language-reviewed. |
| `course/kaiwa-rubrics.json` | **47 requirement descriptions**, over 27 questions in 25 scenarios | Server returns these English descriptions as visible criterion labels, even when the learner-facing question was already Vietnamese-supported. |
| `course/sources.json` | **72 Irodori lesson titles**, e.g. `Lesson 1 Good morning!` | Public source catalog and linked lesson resources. Preserve original title/edition metadata separately. |
| `course/erin-resources.json` | **25 Erin lesson titles**, e.g. `First-meeting Greetings - Classroom -` | Source catalog and resource lessons. The 225 nested link titles inspected use Vietnamese labels; they are not 225 confirmed translation gaps. |
| `course/jlpt-resources.json` | Visible resource titles/help; inspected examples Vietnamese | 111 catalog resources. Preserve edition/year, URLs and official materials. |
| `course/exams.json` | Section/document titles, notice and simulation help; inspected examples Vietnamese | Ten official-paper entries, two per level. Original Japanese external papers/audio remain unchanged. |

### Root path and dependent work

- `static/vi-labels.js:2-11`: finite qualifier/formula mappings; dictionary fetch failures become empty dictionaries.
- `static/learning.js:6-50`: dictionary fallback creates imported meanings/examples and exercises. `:41` joins 政's untranslated `politics` and `government` with `; `.
- `static/lesson-checks.js:6-35`: generated questions reuse those meaning values. `static/practice.js:7-10` grades canonical option strings, not translated DOM text.
- `static/app.js:620-680`: example, word, reading and listening disclosures render those values directly. `:781-833` copies vocabulary meanings/examples to flashcard display.
- `static/workspace.js:94-103,129-146`: mixed quizzes and feature lessons inherit source strings. Explanation-to-translation role conflation at `:146` is a separate teaching-quality defect; translating it alone does not repair its meaning.
- `static/workspace.js:174-195` and `static/app.js:608-610`: search indexes source objects. Runtime DOM translation cannot make `chính trị` searchable while the underlying value remains `politics; government`.
- `scripts/build_teacher_catalog.mjs`: builds canonical tutor catalogs from the same adapters/dictionaries. Any future localization must keep browser and server catalog versions aligned.
- `scripts/translate_corpus.py:20-26,43-63`: optional resumable provider-driven bulk script inventories only the four candidate fields above. It does not cover UI, resource titles, rubric labels, pattern qualifiers or all formula prose. It was **not run** and creates no evidence of completed translation.

## 3. Complete user-feature worklist

Priority **P1** means core comprehension, recovery or meaningful consent; **P2** means consistency/less frequent edges. These are localization priorities, not vulnerability severities.

| ID / priority | User feature and states to cover | Observed gap / current state | Evidence |
|---|---|---|---|
| L01 / P2 | Public landing, demo, registration entry, desktop/mobile navigation, level picker | Mostly Vietnamese. Normalize Sensei/Kanji/Kaiwa/Voice terminology; include tooltips and mobile labels. | `static/index.html:43-129`; `static/refinements.js`; `static/mascot.js`; `static/workspace.js:1`; `static/app.js:38,100,233` |
| L02 / P2 | Email/password register/login, Google login, session expired/unavailable, show password, logout | Auth shell mostly Vietnamese. Google validation details and synthetic account/profile errors may be English. Browser-native validation/Google widget locale is not established. | `static/account.js:30-56,105-120,144-190`; `src/auth.js:47-82,108-113`; `static/index.html:939-959` |
| L03 / P1 | Dashboard, resume lesson, N5-N1 roadmap, library search/filter/pagination | Navigation mostly Vietnamese; dynamic lesson titles/glosses follow source language. Search does not acquire runtime Vietnamese support. | `static/navigation.js:4-27`; `static/workspace.js:174-195`; `static/app.js:545-617`; `static/study-plan.js` |
| L04 / P1 | All seven library skills: kana, grammar, vocabulary, kanji, reading, listening, writing | Translate support fields, not Japanese targets/readings. Imported meanings/examples and formula terminology remain partly English. | `static/learning.js:6-50`; `static/vi-labels.js`; `static/app.js:620-700` |
| L05 / P1 | Lesson checks, chosen answers/distractors, hints, feedback, result/retry/weak review | English meaning pools propagate; source explanations and AI failure text need separate treatment. Preserve question roles and option identity. | `static/lesson-checks.js`; `static/practice.js:65-71,133-164`; `static/workspace.js:146` |
| L06 / P1 | Flashcard front/readings/back/examples, SRS controls, due/empty/review states | Controls mostly Vietnamese; imported back meanings/examples use the same fallback. Do not describe kanji source cards as this feature's deck. | `static/app.js:781-833,1534-1548`; `static/study-teacher.js:203-212` |
| L07 / P1 | Reading aid/translation, listening transcript/translation, dictation reveal | Reused corpus example translations remain English. Preserve Japanese passage/script and no-answer-before-reveal behavior. | `static/learning.js:28-37,95-110`; `static/app.js:679-680` |
| L08 / P2 | Writing prompt, criteria, Japanese model, learner submission/self-report | Existing practical prose largely Vietnamese. Generic teaching bindings do not cover every writing prompt/criterion; include them in coverage, not only visible lesson introduction. | `static/study-plan.js:38-40`; `static/learning.js:72-88` |
| L09 / P1 | Kaiwa reference/session, hints, next prompt, empty answer, evaluation results/uncertainty | Mixed empty-input message, English estimate disclaimer/headings/verdicts, 47 English requirement labels and server-authored English summaries. | `static/index.html:473-486`; `static/app.js:1585-1663`; `src/kaiwa.js:29-35,109-119`; `course/kaiwa-rubrics.json` |
| L10 / P1 | Topic quizzes, mixed sets, timer, answer/explanation/results, official-paper simulation/save/resume | Mixed-set meanings inherit English. Simulation uses `Track`; question/answer Japanese and official documents are intentional originals. | `static/workspace.js:94-103,142-146`; `static/exam-engine.js:17-55`; `src/exams.js:14-25` |
| L11 / P1 | Classroom chat, quick question, inline follow-up, retry/discard, restart/continue | Authored controls mostly Vietnamese; tutor busy/changed-context/invalid-output errors propagate in English. Actual model language remains unverified. | `static/app.js:482-491,1188-1198`; `static/study-teacher.js:70-84`; `src/tutor-chat.js`; `src/tutor-session.js` |
| L12 / P1 | On-demand teaching/translation, hint/feedback and failure/retry states | Selected DOM fields only; no permanent corpus/search translation. Server errors remain English. Source explanation after an answer is not covered by every question translation binding. | `static/study-teacher.js:116-165,177-238`; `src/study-teacher.js:8-13,77-99`; `src/practice-coach.js:26-52` |
| L13 / P2 | Progress, completion/unmark, history, bookmarks, weak items | Most controls/errors Vietnamese; stored titles and `meaning_en` fallback can retain source language. Some backend detail is discarded, not shown English. | `static/completion.js`; `static/app.js:508,1053-1056,1412-1413`; `src/worker.js:167,273,291-366` |
| L14 / P1 | API add-account dialog, local/server key setup, provider/URL/key/help, edit/delete/save | Substantial English in both HTML and runtime status/privacy/confirmation copy. Initial Vietnamese selected-API summary does not establish localized onboarding. | `static/index.html:674-677,714-779`; `static/ai-settings.js:30-124,148-170,530-594,759`; `static/api-profiles.js` |
| L15 / P1 | Model discovery, test consent, paid/quota warning, partial catalog, progress/stop/resume, selected-model save | English consent and recovery can hide material meaning. Preserve one-test-per-model, interrupted-request and no-automatic-retry semantics. | `static/index.html:748-769`; `static/ai-settings.js:190-461`; `static/model-scan.js:63-67`; `src/providers.js:294-366` |
| L16 / P1 | Antigravity/Google account connect, callback recovery, cancel/remove, catalog and per-model quota | English lifecycle/help/status/error/accessibility copy throughout. Unknown quota is not zero; lowest model quota is not shared balance. Do not initiate OAuth merely to audit wording. | `static/index.html:687-712`; `static/antigravity-oauth.js:68-164,204-306`; `src/antigravity-oauth.js`; `src/antigravity-gateway.js` |
| L17 / P1 | Independent voice account, add-key/privacy/storage, speech model, refresh/sample | Almost entirely English for learners, including accessible names and quota/charging notice. Managed-admin branch is mostly Vietnamese. | `static/index.html:784-805`; `static/speech-models.js:56-100,122-230` |
| L18 / P1 | Read-aloud preparation/playback/stop/dismiss, unsupported audio, autoplay failure | English player controls/statuses/errors. Preserve exact Japanese/bilingual transcript, chosen voice and independent account; do not translate requested speech as a UI fix. | `static/index.html:961`; `static/speech.js:28-50,81-123`; `src/speech.js:18-90` |
| L19 / P1 | Recorded input, STT, browser recognition fallback, permission/capability/empty/replay/error | Primary recorded-input normal states mostly Vietnamese; fallback predominantly English and native errors can escape. Translate app guidance, not OS dialogs or learner transcript. | `static/recorded-input.js:13-119`; `static/speech-input.js:22-29,67-68,97-164`; `src/transcription.js:21-48` |
| L20 / P2 | Administrator live conversation, start/mute/end, audio playback, captions/translation/retry | Controls/caption statuses mostly Vietnamese; raw connection/browser errors may escape. Japanese live speech and original transcript are intentional; Vietnamese captions remain separate. | `static/live.js:30-157`; `static/live-transcript.js:12-54`; `src/live.js:17-92` |
| L21 / P2 | Account settings, deletion confirmations, admin user list/search/detail/level/role/reset/purge, managed AI preferences | Mostly Vietnamese. Normalize jargon and recover English detail/native parse errors. No destructive action was exercised. Preserve role and privacy boundaries. | `static/index.html:637-669,807-810`; `static/admin-users.js:6-105`; `static/admin-ai.js:15-74`; `src/admin.js` |
| L22 / P1 | Public source catalog, source switch/search, resource lesson titles, attribution/privacy/help | 72 Irodori and 25 Erin instructional titles are English. Controls mostly Vietnamese; source edition names/legal originals require preservation, not blind replacement. | `static/sources.html`; `static/source-catalog.js:11-30`; `course/sources.json`; `course/erin-resources.json` |
| L23 / P1 | Shared failure handling and assistive output across every feature | Nonempty English `detail`, browser `SyntaxError`/network/media text and runtime accessible names bypass Vietnamese fallbacks. Do not expose raw provider responses. | `static/account.js:30-56`; `static/ai-settings.js:241-249`; `static/practice.js:65-71`; `src/llm.js:100-134,275-282` |

No learner CSV/report export control was found in the static application. Audio object URLs serve replay, not an export feature. Raw source JSON/license links expose originals and are not equivalent to user-facing translated lesson support.

## 4. Shared errors and AI-output contracts

### Error propagation

`data.detail || VietnameseFallback` still displays English whenever `detail` is nonempty. Similar raw `error.message` paths exist in API settings, OAuth, read-aloud, recording, chat, practice and teaching. Some errors are created in the browser itself by `account.js`/`api-profiles.js`, so translating only the server is insufficient.

| Backend group | Modules | Localization consequence |
|---|---|---|
| Authentication, routing, state | `worker.js`, `auth.js`, `admin.js`, `exams.js` | Mixed shared validation/method/not-found/auth prose. Admin action errors largely Vietnamese. Progress/history/completion/exam consumers often replace detail with generic Vietnamese instead of showing it. |
| Connections/providers | `providers.js`, `llm.js`, `antigravity-oauth.js`, `antigravity-gateway.js` | Broad English profile, catalog, key/access/quota, callback and reconnection detail reaches direct-display consumers. |
| Tutor | `tutor-chat.js`, `tutor-session.js`, `practice-coach.js`, `study-teacher.js` | English reference/lease/concurrency/replay/catalog/output failures need usable Vietnamese recovery. |
| Audio/evaluation | `speech.js`, `transcription.js`, `live.js`, `kaiwa.js` | TTS errors and Kaiwa successful summaries/labels English; STT/live largely Vietnamese but native/browser exceptions can escape. |
| Supporting modules | `admin-ai.js`, `local-admin.js`, `ai-usage.js`, `ai-secrets.js`, `prompt.js`, `tutor-context.js` | Mostly identifiers, boolean/null outcomes and internal instructions. Crypto configuration errors should not expose internals; callers generally sanitize them. Do not translate every internal literal blindly. |

Stable error codes exist only on some paths. Preserve `code`, HTTP/provider status, retry timing, IDs, action/verdict enums and diagnostics. Translate human presentation consistently. Many consumers parse JSON before checking status; HTML/text/empty infrastructure responses can expose English parser errors. Conversely internal sentinels such as `Error('save')` are already caught by Vietnamese messages and are not themselves user-visible defects.

Provider response bodies are deliberately sanitized (`src/llm.js:100-134`). Do not restore them to obtain a supposedly clearer translation. Retain key/account isolation, explicit retry and no-silent-fallback behavior.

### Generated prose

- Tutor (`src/prompt.js:65-103`): Vietnamese explanation with Japanese examples. English-authored prompt is internal; schema-valid output is not language/teaching-quality proof.
- Coaching (`src/practice-coach.js:7-15`): natural Vietnamese, useful Japanese, phase-safe hints and unchanged grading. Do not reveal the solution while translating options.
- Teaching (`src/study-teacher.js:8-13`): Vietnamese requested fields plus short teaching/self-check. Japanese-only options remain verbatim. Japanese-sequence/schema validation does not certify semantic fidelity.
- Kaiwa (`src/kaiwa.js`): natural Japanese model answer and exact learner evidence remain Japanese. Server-authored criterion labels/summary need translation independently of the model prompt.
- Continuous voice (`src/live.js:68-81`): Japanese speech, brief Vietnamese explanation as needed; captions separately request Vietnamese. Do not force the whole speaking exercise into Vietnamese.
- TTS (`src/speech.js:10-16,78-82`): read the exact transcript; do not paraphrase or translate it. Localize controls and errors, not canonical speech input.
- STT (`src/transcription.js:40-47`): retain the learner's actual words. Transcription is not translation.

No live generation, language-detector validation, pronunciation review or human pedagogical acceptance occurred in this audit.

## 5. Actual browser observations and limits

Observed on the real baseline frontend with synthetic authenticated API responses:

1. Landing and login/register shell; Vietnamese demo/navigation.
2. Ten route views: `#dashboard`, `#settings/api`, `#settings/sound`, `#settings/data`, `#curriculum/N2/library/kanji`, `#flashcards/N3`, `#kaiwa/N5`, `#quiz/N3`, `#mastery`, `#classroom`.
3. `#curriculum/N3/library/kanji`, first lesson, opened first word: exact `政` / `politics; government` reproduction. Practice tab reproduced the four English choices from the user's screenshot, without requesting teaching.
4. API add-account dialog: `How would you like to connect?`, `Use an API key`, `Sign in with Google`; accessibility tree exposes English names. Key editor mixes Vietnamese framing with English storage/provider/privacy/help/save/cancel text. No credential entered or saved.
5. Learner Sound view and Add key form: `Voice & read-aloud`, `Voice account`, `Choose a saved voice account`, `Listen to a sample`, charging notice and accessible field names remain English. No sample, catalog refresh or synthesis initiated.
6. N5 freestyle Kaiwa reference and session opened through normal controls. Empty submission displays `Nói hoặc nhập câu trả lời trước khi nhận xét. Nothing has been graded.` No AI evaluation was sent.
7. Public `sources.html`: 25 English Erin headings; switching to Starter displays English Irodori headings such as `Lesson 1 Good morning!`.

Screenshots and accessibility/text observations were collected during the run. They demonstrate rendering, not successful authentication, persistence, provider behavior or complete cross-device accessibility.

**Not dynamically exercised:** real Google/OAuth consent/callback, saved keys/accounts or model scans, quota exhaustion/billing failures, successful AI teaching/evaluation, admin actions/settings, microphone/recording/recognition, TTS/live audio/WebRTC, nonempty historical progress/bookmarks, official-paper save/submit, every N5-N1 lesson, every result state, mobile-specific layout, third-party/native dialog locale and external publisher media. Those surfaces are source-inventoried above; they are not silently counted as browser acceptance.

The static preview has no backend. Its API 404/empty-fixture failures are audit-harness limitations, not reported production bugs. An initial same-document navigation failed to rerun auth bootstrap; a full URL navigation established the fixture. A browser interception cleanup discrepancy was reported through the tool's issue channel. No product fix or suppressed failure was introduced.

## 6. Reproduction of coverage counts

Run from this baseline's repository root with Python 3. This read-only extraction mirrors translator candidate selection and runtime dictionary lookup; it writes no file and sends no network request.

```python
import json
from pathlib import Path

root = Path('static')
load = lambda path: json.loads(path.read_text(encoding='utf-8'))
dictionary = load(root / 'course/vi-grammar.json')
optional = root / 'course/vi-dict.json'
if optional.exists():
    dictionary.update(load(optional))
all_text = []
for level in ('n5', 'n4', 'n3', 'n2', 'n1'):
    texts = []
    for kind in ('vocab', 'grammar', 'kanji'):
        for row in load(root / 'openjlpt' / f'{kind}-{level}.json'):
            candidates = list(row.get('meanings') or [])
            candidates += [row.get('meaning'), row.get('notes')]
            candidates += [ex.get('en') for ex in row.get('examples') or []]
            texts += [value for value in candidates if isinstance(value, str) and value]
    hits = sum(bool(dictionary.get(value)) for value in texts)
    print(level.upper(), len(texts), hits, len(texts) - hits)
    all_text.extend(texts)
unique = set(all_text)
print('dictionary', len(dictionary), 'optional', optional.exists())
print('occurrences', len(all_text), 'unique', len(unique))
print('unique hits', sum(value in dictionary for value in unique))
print('unique missing', sum(value not in dictionary for value in unique))
```

Observed: N5 `2739 175 2564`; N4 `3008 162 2846`; N3 `9531 165 9366`; N2 `8954 154 8800`; N1 `17602 162 17440`; dictionary `807`, optional `False`; occurrences `41834`, unique `29317`, unique hits `807`, unique missing `28510`. Separate per-kind/field extraction and resource/rubric counts agreed with the tables above.

## 7. Implementation order and acceptance

This section defines the worklist, not completed implementation or authorization for paid operations.

1. **UI and material notices:** connection/OAuth/voice forms, consent, privacy, charging/quota semantics, Kaiwa advisories, visible/assistive labels and all runtime states. These should not depend on a learner paying for an AI translation to understand controls.
2. **Shared failure presentation:** map authored server/browser failures into consistent Vietnamese guidance while retaining codes/status/identity and sanitized diagnostics. Handle non-JSON/network/media failures without raw English exception leakage or fabricated success.
3. **Learning-content path:** resolve missing Vietnamese support for vocabulary/kanji/grammar/examples and all generated choice consumers. Reuse existing dictionaries/adapters; preserve original corpus bytes and reviewed context. Current explicit runtime teaching remains useful but is not complete default localization. The prior selected-chat-API teaching direction does not authorize an automatic bulk job, model switch or voice-account reuse.
4. **Remaining source/rubric prose:** 47 Kaiwa requirements, 97 resource lesson titles, formula qualifiers, legacy authored content and saved-title presentation. Distinguish explanation, translation and answer roles; do not repair canonical keys by translation.
5. **Final coverage proof:** all five levels; relevant skill/reference/practice/flashcard/quiz/Kaiwa/progress routes; regular/admin roles; connected/unconnected and success/failure/retry states; accessible names; Vietnamese search; reload/account/route changes; browser/server catalog parity. Verify no grading/option/history/source/voice changes. Real model language and pedagogy remain separate acceptance gates.

Before product edits, agree file ownership/handoff with the active teaching-quality writer and rebase the inventory onto the selected integration base. Its committed branch already adds N5-N1 teaching packages, typed tasks and learning-source RAG; its current working changes continue evolving. Those unmerged/new modules are **not** implicitly certified by this main-baseline audit. Reconcile their visible prompts, session/feedback states, source cards and errors when integration is selected.

Only this report is published by this checkpoint. No application translation, dictionary generation, migration, dependency install, PR, merge or deployment is part of it. Documentation/content checks and browser observations are the evidence; an application test suite would not certify the language inventory.

## 8. Implementation checkpoint — 2026-11-14

The user authorized implementation, selected complete static Vietnamese support rather than API-only runtime translation, and explicitly retained the teaching-quality writer's ownership of overlapping learner-renderer files until handoff.

- Implementation worktree: `C:/Users/TRI/VJ_BOT-vietnamese`, branch `feature/vietnamese-localization`, base `67b60f05f2ead90f825cc994791fb387c3dca7aa`. The inventory above was copied as commit `b4c416a`; its historical counts remain pinned to the original audit baseline.
- Implemented non-overlapping API/OAuth/account/admin/audio interface copy, material privacy/quota/charging notices, authored service errors and bounded browser-error recovery. No schema, status/code, scoring, credentials, model selection, account/voice isolation or retry algorithm was intentionally changed.
- All 47 learner-facing Kaiwa requirement descriptions now use Vietnamese. Question text, IDs, ordering and every non-description rubric field were checked unchanged.
- Added 97 Vietnamese resource titles through the existing `vi-dict.json` lookup. Source JSON stays unchanged. The public catalog retains original titles in search, displays Vietnamese, and preserves link destinations. Compound grammar terminology is matched before individual words.
- Real Edge observed the localized add-account dialog, API editor and voice-account form with their accessibility names. The public source catalog displayed Vietnamese Erin/Irodori titles; both `Nhờ vả` and `Making Requests` found the same original lesson/link. These authenticated form observations used explicit synthetic session/state responses, not real accounts or provider activity.
- First integrated focused run: 322 passed, five failures. Two assertions pinned obsolete English wording; three test files could not import installed dependencies from this new worktree. Replaced the wording-only assertions with grouping/identity behavior or retained existing stop/no-retry behavior. Reused the existing installed dependencies through an ignored local directory junction; no installation or lockfile change.
- Affected recheck: `node --test tests/ai-settings.test.mjs tests/model-scan.test.mjs tests/antigravity-oauth.test.mjs tests/api-profile-backend.test.mjs tests/tutor-session.test.mjs` passed **144/144**. `node --test tests/vietnamese-localization.test.mjs` passed **2/2**, exercising real title dictionary/search/link behavior and compound Japanese grammar-label preservation.
- Frontend review identified lost network guidance in recorded input and overly broad audio assertions. Marked the authored network error as learner-facing; restored failure-specific assertions and separate quota/charging checks. `node --test tests/account.test.mjs tests/recorded-input.test.mjs tests/microphone.test.mjs tests/speech.test.mjs tests/speech-models.test.mjs tests/speech-ui.test.mjs` passed **112/112**, including a disconnected STT request that preserves typed text, starts no microphone capture and sends exactly one request.
- Independent backend review found removed advisory assertions. Restored explicit Vietnamese checks for unofficial scoring and potentially incorrect AI examples; `node --test tests/kaiwa-security.test.mjs` passed **16/16**. Both review findings were fixed without changing service protocols or inference behavior.
- Corpus review found 4,426 missing gloss keys reused across multiple Japanese terms. Translation workers received all associated Japanese contexts; a first-context-only translation can lose senses, such as `party` covering both factions and a social gathering.
- The source corpus also contains pre-existing Japanese/English disagreements, including `smelt` attached to `鮎`, uncovered versus `未発掘`, folded versus `織り`, and off-line versus `オンライン`. Original records remain unchanged; dictionary coverage alone does not certify those source pairs or authorize grading them as correct.
- At interface checkpoint `657aa8e`, pushed to the existing origin task branch, corpus translation and review/integration were still in progress. Its 97-entry dictionary contained only resource-title support, not the missing 28,510 corpus keys.

Pending canonical-writer handoff: English Kaiwa result/verdict/reset/empty-input strings in `static/app.js`, task-unavailable/quarantine messages in `static/lesson-checks.js`, forwarded task-reference errors in `src/tutor-context.js`, coaching errors in `src/practice-coach.js`, newer learning/session states, source-title presentation in learner adapters and `tests/worker.test.mjs` English-only assertions. These files were not edited by the localization workstream. A prepared session-local handoff records the exact changes and revision/catalog/choice-collision risks; it is not a delivered peer message or an accepted ownership transfer.

No complete-app localization, human translation/pedagogical approval, live-model behavior, microphone/voice quality, production publication, PR, main merge, deployment or migration is claimed by this intermediate checkpoint.

## 9. Corpus draft and semantic integration gate

The continuation preserves completed translation artifacts instead of restarting them. No bulk provider API, installation, account change or source rewrite was performed.

- All six translation batches now cover exactly **28,510 missing source keys**, with zero missing, unknown, duplicate shard keys or empty values. `vi-dict.json` contains **28,607 entries** including 97 resource titles; the separate 807 existing grammar translations were not overwritten. Combined lookup covers all **41,834 source occurrences**: N5 2,739, N4 3,008, N3 9,531, N2 8,954 and N1 17,602, with zero missing lookups in each level. Original 15 OpenJLPT files remain byte-identical to the audit worktree. Unchanged output tokens are proper names, numbers/units/symbols and established loanwords such as `taxi` and `vitamin`, not placeholder translations.
- Actual Edge displayed Vietnamese Kanji details in N5, N4, N3, N2 and N1. The reported `政` detail and its generated answer choices now display Vietnamese. Browser authentication/profile/progress were explicit synthetic fixtures; the lesson adapters, dictionary, DOM and navigation were real. Only intentionally blocked Google-font/sign-in requests appeared in collected page errors, not JavaScript execution exceptions.
- Those screens also exposed a **blocking semantic limitation**: a flat English-key dictionary cannot select a Japanese-specific sense. For example, `party` includes a social gathering under political `党`, and `lead` includes the metal `chì` under `連`. Broadening shared English senses prevents omissions but does not solve this ambiguity. Complete lookup coverage is not complete Japanese teaching support.
- The canonical teaching-quality/integration writer still owns `static/learning.js`, `static/workspace.js` and related learner renderers. Its newly active `fix/learner-lesson-clarity` branch was observed in shared status; none of its changes were copied or overwritten. Contextual lookup must bind to immutable source record/term identity, preserve original source evidence, and use the same mapping in browser and server catalogs. It requires an explicit handoff or integration by that owner.
- Pre-existing mismatches also include `dumb`/`ダム`, `a scatter`/`統計`, `brushy`/`ブラシ`, `a slut`/`だらしない`, `fun`/`ファン`, `sanctity`/`本気`, `next word`/`弁償`, `method of attack`/`せめて`, `ordinance`/`兵器・武器`, `245 acres`/`反`, and conflicting numbers/names in examples. Do not mark these records correct merely because their English strings now have Vietnamese translations.
- Additional original mismatches flagged in the final batch: `dyer`/`ダイヤ`, `in person`/`直ちに`, `nuts!`/`熱中`, `forester`/`林`, `a particular`/`しかる`, `half minute`/`半分`, `I can't be sorry.`/`そうしてくださればとてもうれしい。`, and `Neither of my parents is alive.`/`両親とも生きているわけではない。`. The last Japanese sentence does not establish that both parents have died. Preserving the English meaning does not make those Japanese/Vietnamese pairs correct.
- A real all-level catalog build in memory preserved all 47,525 canonical task IDs and their answer indices, accepted responses, option counts, Japanese passages/scripts/targets/parts, source positions/identities, capabilities and review/availability flags. Translated payloads changed 24,919 task revisions as expected. The only duplicate-choice task, `exam-N1:2-q3`, already had separately numbered duplicate `あれ` choices before translation; no new duplicate choices were introduced. No generated catalog was written into another owner's scope.
- `node --test tests/task-contract.test.mjs tests/vietnamese-localization.test.mjs tests/source-catalog.test.mjs` initially passed 17/23: six public-catalog tests lacked the new existing `vi-labels.js` dependency in their isolated fixture. Added that actual dependency without weakening assertions; `node --test tests/source-catalog.test.mjs` then passed **8/8**. The unchanged canonical-task and dictionary/title tests had already passed **15/15** in the combined run.
- Final 390px Edge proof used the completed dictionary on N3 Kanji, N5 grammar and N1 vocabulary, including their generated choice screens. The final observed viewport was 390px with 375px document width, with Vietnamese radio names and no horizontal overflow. This is presentation evidence, not approval of the overly broad shared-gloss meanings.
- No CLI catalog generation or deployment dry-run was run because generated catalogs remain in the canonical writer's retained scope. The existing `buildTeacherCatalog()` was executed in memory for identity/revision comparison, and the existing task-contract test independently compared browser builders with server catalog output.
- Independent final review found additional **introduced** context errors: global `mean` adds `hèn hạ; có nghĩa là` under `中`, and `light` adds `nhẹ; dễ` under `明`. These are not original Japanese/English source defects; they result from applying all English senses to every Japanese use. Both reviewers agreed the explicit draft-only publication wording does not certify readiness. Contextual mapping must correct these before integration, including the generated answer path.

This corpus draft is not ready for production integration until contextual meaning and affected source-advisory availability are reviewed by the canonical writer. No human Japanese approval, independent pedagogical acceptance or merge/deployment is implied.
