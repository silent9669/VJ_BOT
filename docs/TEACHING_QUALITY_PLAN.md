# Whole-application teaching quality plan

## Decision and scope

Improve the existing tutor, not replace its architecture or repaint two broken screens. Repair the shared source-to-task contract first; then deliver reviewed teaching and varied practice across **N5, N4, N3, N2 and N1**. A stronger model cannot recover discarded passages, identify an omitted target, or make a defective answer key authoritative.

The original planning checkpoint changed no application code, grading, source records, learner history, production data, provider settings or deployment. Sections 1–6 preserve that baseline and its proposed gates. **Section 7 records the subsequent user-authorized implementation checkpoint and its remaining acceptance limits.**

Baseline: `204b55b8d994a36c4a5bceb77b62c7bb2f33014e`, the committed main inspected on 2026-11-13. The complete addressable structural inventory is [TEACHING_QUALITY_AUDIT.json](TEACHING_QUALITY_AUDIT.json). Counts describe that revision, not every future acquisition branch.

## 1. What was actually inspected

A read-only local VM executed the repository's lesson adapters and the same catalog builder used by the application. It traversed every current source record and generated lesson/check collection, deduplicating aliases by canonical activity identity. Catalog lesson counts independently matched the traversed identities at every level. Source hashes, per-lesson issue indices, original exam positions and source-language candidates are retained in the audit.

| Level | Raw OpenJLPT records | Canonical reachable lessons | Computed five-check entries | Full in-app quiz questions |
|---|---:|---:|---:|---:|
| N5 | 839 | 454 | 2,270 | 228 |
| N4 | 897 | 429 | 2,145 | 223 |
| N3 | 2,147 | 862 | 4,310 | 220 |
| N2 | 2,299 | 866 | 4,330 | 217 |
| N1 | 4,538 | 1,302 | 6,510 | 214 |
| **Total** | **10,720** | **3,913** | **19,565** | **1,102** |

Denominators matter:

- Raw records comprise **7,811 vocabulary, 526 grammar and 2,383 kanji records**, with **15,244 example occurrences**. Occurrences are not necessarily unique sentences.
- The five-check count is the current generator's output, including supplementary checks attached to writing/dictation. It is not a count of independently authored, distinct or pedagogically approved tasks.
- There are 4,495 surface aliases and 3,913 canonical lesson identities. Seven descriptor differences are added `id` metadata only, not seven conflicting learning payloads.
- Full quizzes include **42 original authored questions**, **60 practical questions** and adapter-generated practice sets. Their 1,102 positions overlap five-check previews; do not add these counts as unique questions.
- The canonical catalogs hold 20,316 question entries and retain 1,102 full-exam entries separately. Preview truncation is not loss of the entire server-side exam inventory.
- Also inspected: **40 chapter declarations, 20 practical units/production tasks, all 10 original star-order questions, 25 authored Kaiwa scenarios and 27 question-specific rubrics**.
- External metadata contains 10 official papers, 1,001 answer positions, 72 source entries, 111 JLPT resource entries and 25 Erin entries. Publisher PDFs/audio were not downloaded or semantically reviewed.
- An AI editorial pass read all 42 original exam questions and all 20 practical units, including their 60 questions and corresponding practical rubrics. **This is not human approval.** The remaining corpus has structural coverage, not exhaustive independent Japanese-language review.

### Reproducing the structural evidence

The extraction used **Node v24.14.0**, local files only, and no installed project dependencies. Reconstruct the traversal against the pinned baseline, not today's mutable main:

1. Create a VM with local-file `fetch`, `window` and the repository's actual `jlpt-data.js`, `vi-labels.js`, `learning.js`, `lesson-checks.js`, `study-plan.js`, `workspace.js` and `completion.js`, in that order. Snapshot original exam records before adapters append generated sets.
2. Load the practical course and translation dictionary. For each level, call `ensureLessons(level)` and `createStudyPlan(level)`. Enumerate curriculum skills, non-kind roadmap steps, and `featureLessons` for flashcards, Kaiwa and quiz. Deduplicate by level plus `activityId`, preserving every surface alias.
3. Enumerate each lesson's `lessonQuestions` and original drills; retain collection/index and `item_id`. Apply the audit's `rules` definitions and `location_conventions`, not a semantic model verdict. In particular, TQ05 measures source-drill positions outside the preview; TQ09 measures raw records with unmapped Latin-bearing English-source fields.
4. Independently invoke `buildTeacherCatalog()` and compare lesson, question, full-exam and progress-item counts. Traverse all fifteen raw OpenJLPT arrays and the authored course/exam/rubric metadata separately; they are different overlapping inventories.
5. Verify every `source_hashes` entry before comparing IDs or counts. The audit is a pinned snapshot, not a new executable validator; its temporary extraction script was removed after inspection. Exact extraction-source preservation is a reproducibility limitation, not independent semantic approval.

The existing catalog builder can be inspected without generating files:

```sh
node --input-type=module -e "import {buildTeacherCatalog} from './scripts/build_teacher_catalog.mjs'; const c=await buildTeacherCatalog(); for(const [level,x] of Object.entries(c)) console.log(level,{lessons:Object.keys(x.lessons).length,items:Object.keys(x.items).length,questions:Object.values(x.lessons).reduce((n,l)=>n+l.questions.length,0),exam_questions:Object.values(x.lessons).reduce((n,l)=>n+(l.exam_questions?.length||0),0)});"
```

### Actual surfaces and dependencies

| Surface | Current implementation | Required scope |
|---|---|---|
| Roadmap, dashboard, library and lesson reference | `static/study-plan.js`, `workspace.js`, `app.js` | Objectives, prerequisites, accurate task counts, reference/context roles and honest completion labels |
| Vocabulary, kana, kanji and grammar | `static/learning.js`, `lesson-checks.js` | Meaning, reading, form, contextual usage and recall; not meaning-only recognition |
| Reading and practical situations | `static/learning.js`, `study-plan.js`, `practice.js` | Passage/dialogue stays accessible while answering; evidence-based feedback |
| Listening and dictation | `static/learning.js`, `speech.js` | Explicit listening task, transcript timing, retained attempted text and separate self-report |
| Writing | `static/learning.js` | Task-specific criteria, actual submitted work and separate advisory/self-assessed evidence |
| Flashcards and weak-item review | `static/app.js`, `workspace.js` | Stable source identity, deliberate reveal/recall, canonical review routing and accessible card state |
| Quiz reference, preview and full quiz | `static/workspace.js`, `lesson-checks.js`, `app.js`, `study-teacher.js` | Complete task context, original option identities and explicit preview/full-set coverage |
| Official timed workbooks | `static/exam-engine.js`, `src/exams.js` | Preserve original documents, answer positions, timer and raw-score limitations |
| Kaiwa preparation/evaluation | `static/app.js`, `src/kaiwa.js`, `course/kaiwa-rubrics.json` | Current spoken question, matching aid/rubric and advisory text-only assessment |
| Inline teacher, classroom and popover | `static/study-teacher.js`, `teacher-context.js`, `src/study-teacher.js`, `practice-coach.js`, `tutor-context.js`, `tutor-chat.js`, `prompt.js` | Typed canonical evidence, phase-safe hints, original/generated comparison and appropriate level scaffolding |
| Progress, SRS and manual completion | `static/practice.js`, `learning.js`, `study-plan.js`, `completion.js`, `src/worker.js` | Preserve history while distinguishing completion, coverage, objective evidence, self-report and AI estimates |
| Linked publisher resources | `static/navigation.js`, source metadata | Accurate external-resource labels; no invented internal exercises or assumed ingestion rights |

Data flows from source records through `learning.js` / `study-plan.js` / `workspace.js` into both learner renderers and `scripts/build_teacher_catalog.mjs`. The catalog then supplies chat, inline teaching and coaching. **Fixing only labels or prompts leaves the same bad evidence in the server catalog.**

## 2. Confirmed shared defects and review candidates

The JSON audit defines TQ01–TQ12 and records exact zero-based issue locations. Counts can overlap; they are not an overall error rate.

| ID / priority | Evidence and measured scope | Required outcome |
|---|---|---|
| TQ01 / P0 | `workspace.js:146` assigns explanation or correct option to `examples[].vi`; `app.js:620-636` calls it “Nghĩa.” **1,102 quiz-example occurrences across 80 lessons** use this projection. | Separate translation, solution and rationale at source-adapter level. Do not claim all 1,102 individual strings were independently judged wrong. |
| TQ02 / P0 | **70 passage-bearing quiz examples across 30 lessons** omit the passage field. `practice.js:110` also renders only the check prompt while `app.js:710-717` hides ordinary lesson reference. | All reading/situation tasks carry their required stimulus into the answering state. The 70 count covers quiz examples only, not every affected reading screen. |
| TQ03 / P0 | Three source kanji targets are not identified by the derived instruction. Full quiz initially underlines targets at `app.js:983-990`, but `study-teacher.js:233-234` unconditionally overwrites the rendering with flattened text before any AI click. | Keep task rendering authoritative. Preserve target identity and structured passage presentation in every view, not just the three flat-prompt witnesses. |
| TQ04 / P0 | **29 short quiz lessons gain 49 filler checks** to reach five. A rationale can become the answer to a fabricated translation question. | Keep authored counts. Never manufacture a translation task from an answer explanation. |
| TQ05 / P1 | **583 lessons omit 8,396 source-drill positions from the five-check preview**. Full exams are separately retained. Preview/full quiz share completion identity. | Name subsets honestly; full-set completion requires explicit coverage. Do not confuse a preview with all available practice. |
| TQ06 / P1 | **19,094 / 19,565 generated checks** lack a nonempty authored explanation field. Mixed-set explanations can be only the answer text. | After an attempt, explain the deciding evidence and the learner's actual error. A populated field or optional AI button alone is not adequate feedback. |
| TQ07 / observation | Generated checks pass mechanical prompt/answer/choice checks. This happens after normalization. | Preserve this mechanical floor, but never use it to certify Japanese correctness or original option identity. |
| TQ08 / P1 | **2,570 displayed checks across 514 OpenJLPT vocabulary/kanji lessons** are exclusively meaning recognition. All 526 imported grammar lessons begin with a meaning-recognition drill. | Add reviewed recall, formation and contextual-transfer tasks appropriate to the objective. Changing distractor order is not diversity. |
| TQ09 / review | **10,557 source records** contain at least one unmapped Latin-letter source field; **41,001 of 41,834 inspected English-source field occurrences** are unmapped Latin-bearing fields. `vi-dict.json` is absent. Names/terms may legitimately remain unchanged. | Explicit source-language/missing-translation state and selected-API runtime teaching. This is not 41,001 proven mistranslations or permission for bulk translation. |
| TQ10 / review | **52 grammar lessons** have fewer than three source examples. | Review adequacy and contrast coverage; do not pad examples just to satisfy a count. |
| TQ11 / P1 | **3,690 OpenJLPT-derived lessons** have no explicit authored measurable-goal field. | Review objectives and task alignment. An absent field is not proof a learner can learn nothing. |
| TQ12 / observation | No distinct displayed prompt/answer pair within the same lesson reused an `item_id` in this finite scan. | Still preserve cross-view IDs, original option positions and historical attempts during remediation. |

Additional confirmed cross-cutting findings:

1. **Option identity is lost in preview normalization.** `lesson-checks.js:6-14` deduplicates/reorders option strings, and `practice.js` grades strings. Full quiz uses numeric source positions. N1/exam2/q3 contains two legitimate separately numbered `あれ` parts; collapsing them changes the task.
2. **Canonical does not mean correct.** The catalog associates examples through string/answer equality and whole-unit fallback (`build_teacher_catalog.mjs:38-41`). Its quiz collection also receives a fallback `listening` skill. Author explicit task/example references and assessed skills.
3. **Pre-answer evidence can already contain an answer.** `practice-coach.js:39-43` sends associated example glosses in hint requests. Those glosses can equal the translation answer or contain its rationale. This establishes exposure in request evidence, **not a measured live-model leak rate**.
4. **Writing/dictation self-report enters correctness/SRS.** `learning.js:74-112` treats checked writing criteria as correct and accepts dictation “understood” after revealing the transcript, without comparing/submitting the attempted dictation. Both branches continue into generic checks. Eight characters do not establish a relevant Japanese answer.
5. **Completion is not mastery.** Manual completion, last-correct step status, client-submitted correctness and `total_learned` are distinct mechanisms. The progress endpoint can accept item IDs outside the seeded curriculum (`worker.js:300-346`). Preserve useful practice records without advertising server-verified mastery.
6. **Weak-item review uses display text rather than a canonical selector.** Fix review ownership, not just its wording (`app.js:1093-1124`).
7. **Accessibility needs task-level repair.** Full quiz does not consistently announce feedback/new questions or name a correct option without color. Japanese containers lack appropriate language annotations, and flashcard flipping does not announce its side. Preserve the native radio/fieldset/status behavior already present in five-check practice. Actual assistive-technology acceptance remains unperformed.

### Addressable authored-content findings

These are AI editorial findings, not approved replacement content. Preserve original records; quarantine defective tasks from scored use until adjudicated.

| Address | Finding | Status |
|---|---|---|
| N4 / exam1 / q3, `jlpt-data.js:2004-2020` | Four supplied parts, but explanation uses three; third/star position disagrees with the stored selected part. | Confirmed internal contradiction |
| N3 / exam1 / q3, `:2166-2182` | Four supplied parts but five-piece explanation introduces unsupplied `わかる`; parts/options disagree. | Confirmed internal contradiction |
| N3 / exam2 / q3, `:2246-2262` | Explanation's third piece is `私は`; key selects fourth piece `決して`. | Confirmed internal contradiction |
| N2 / exam2 / q3, `:2408-2424` | Explanation's third piece is `従わ`; key selects fourth piece `ざる`. | Confirmed internal contradiction |
| N2 / exam1 / q3, `:2328-2344` | Named `〜にほかならない` construction disagrees with supplied assembly `結晶にほかにならない`. | Confirmed internal formula/assembly disagreement; correction still needs review |
| N1 / exam1 / q3, `:2490-2506` | Proposed assembly joins `非常識にも程がある` to `極まりない`. | Naturalness/grammar review candidate |
| N4 / exam1 / q2, `:1988-1998` | Accident context may permit both delay and stopping; rationale does not establish unique choice. | Ambiguity review candidate |
| N5 / exam1 / q5; N5 / exam2 / q3; N4 / exam2 / q3 | Alternative grammatical ordering may change the third/star answer. | Three uniqueness-review candidates, not new accepted keys |
| `practical:v1:N4:late`, `practical.json:749-756` | Written production model omits current location asked by the separate spoken question. | Confirmed scope mismatch **if** reused as a complete Kaiwa model; keep tasks separate |
| `practical:v1:N2:policy`, `:1666,1711-1713` | Source specifies the first day of next month; production model reduces it to next month despite an effective-date criterion. | Confirmed loss of source precision; editorial adjudication required |

All **32 non-star original exam questions select source option index 0**. This is answer-position bias, not proof those keys are wrong. Display randomization, if introduced, must map immutable option IDs back to original positions. The 20 practical spoken questions match their question-specific rubric entries; broader written-production extras must not be added to spoken grading.

## 3. Target teaching contract

Extend the existing data model and selectors. Do not introduce another application, RAG stack or parallel source of grading truth.

### Typed evidence and identity

- Keep stable source, lesson, item and option identities, original indices, source locators, provenance and source bytes. Add content revision, assessed skill, explicit objective and editorial status.
- Distinguish **sentence meaning, sentence translation, instruction translation, reading, usage note, hint, answer, answer explanation, worked example and production model**. No fallback from one role to another.
- A task owns its type, instruction, stimulus references, marked target, original options/parts, key or accepted variants, rationale and evidence. A passage/dialogue/audio reference is required when the question depends on it.
- Arrangement tasks retain separately identified parts and multiplicity, slot/star position and validated complete order. String deduplication is invalid. Review defensible alternative orders before declaring a unique key.
- Missing, disputed, unavailable and unreviewed fields remain explicit. Never invent Japanese/translation content to complete a schema. Confirmed defective questions cannot remain eligible for scored practice while awaiting review.
- Add reviewed corrections as versioned editorial records referencing originals; do not overwrite pinned OpenJLPT snapshots or silently change historical answer indices. Original authored mistakes also need revision history, not an untraceable key edit.
- Rights metadata distinguishes linking, display, adaptation, redistribution and provider processing. Attribution is not admission permission.

### Eligibility: editorial status and rights are separate gates

Slice A must implement this status-to-capability policy in both UI and server selectors. An allowed editorial action still requires the corresponding display, adaptation and processing rights. A field or task does not become approved because its parent lesson is approved.

| Editorial state | Local learner display | Provider hints/teaching | Assessment and progress |
|---|---|---|---|
| Reviewed and approved for the declared task/revision | Display with required context and provenance | Only permitted roles/phase and authorized processing | Deterministic reviewed keys/accepted variants may produce assessed evidence; other modes remain explicitly advisory/self-assessed |
| Unreviewed or needs revision | Labeled reference or exploratory practice only; no claim of correct teaching | Only when provider processing is allowed, with unreviewed-source disclosure and an uncertainty path; no model repair of grading truth | Non-scored by default; no objective accuracy/mastery credit until adjudicated |
| Reference-only | Labeled reference, not an implicit test | Attributed explanation if processing/adaptation is allowed | No assessment contribution; optional explicitly manual/reference completion only |
| Confirmed invalid or quarantined | Show an unavailable/disputed task notice, not a misleading solvable assessment; editorial source view may retain originals | No answer justification or assessment; a limited explanation of the known issue only if safe and rights-permitted | Reject scored submissions; keep historical attempts with invalidated basis; no new correctness, SRS success or full-set pass |
| Rights-restricted or unknown for the requested action | Only rights-permitted metadata/link/reference content | **Do not submit source content to chat, TTS or another provider without an established permitted basis** | No task use that requires an unauthorized adaptation; block that capability rather than fabricate substitutes |

If all tasks in a lesson are blocked, show the exact limitation and any permitted reference. Disable scoring and assessed completion; do not add filler, award an automatic pass or claim full coverage. Keep original task slots stable when quarantining. Full sets containing unavailable required slots show partial/unavailable coverage, not 100% completed by shrinking the denominator. Rights restrictions take precedence over editorial approval.

### Finite supported task modes

Freeze a finite declaration before content authors add exercises. Reuse native controls, not a new practice framework:

| Submission mode | Existing-control implementation and assessment basis |
|---|---|
| Single choice | Radios keyed by immutable option IDs; deterministic reviewed key, not string equality |
| Arrangement/star position | Distinct part IDs with complete context and explicit star slot; source-index choices or a simple ordered input, with a reviewed permutation/accepted-order contract |
| Short recall/construction/correction | Text input or textarea; deterministic scoring only for reviewed accepted variants and explicit orthographic normalization; otherwise non-scored feedback |
| Dictation | Retained attempted text, separate transcript reveal and reviewed orthographic variants; self-rating remains a separate event |
| Writing response | Existing textarea plus task-specific criteria and response evidence; advisory/self-assessment until an independently validated grading basis exists |
| Kaiwa response | Existing text/transcription entry and question-specific rubric; advisory text-only estimate, never automatic pronunciation/mastery certification |
| Flashcard recall self-assessment | Explicit reveal and labeled self-rating; no conversion into objectively verified correctness |

Slice C owns submission, feedback, reveal and keyboard behavior for each supported mode; slice E owns persistence and aggregation. Slice D must accept the relevant non-choice question evidence without inventing two dummy options to satisfy the current validator. Reject unsupported declarations before publishing a lesson. The per-level objective map in F must identify actual recognition, recall/application and transfer tasks by these executable modes; shuffled choices or renamed recognition tasks cannot satisfy recall/production coverage.

### Per-attempt learner experience

1. **Before attempt:** show what skill is tested, an actionable instruction, complete stimulus and an unambiguous target. Keep needed passage/audio available. Conceal the answer, worked solution and answer-equivalent glosses.
2. **Optional hint:** one task-safe clue. Build its evidence by phase/role, not by deleting only a property named `answer`. Translation practice must not receive its answer through an example gloss. Above-level quoted material can still receive explicit translation help with simpler scaffolding.
3. **After attempt:** identify the selected and correct option text/ID, explain decisive passage evidence or grammar, contrast the selected mistake without declaring all distractors universally ungrammatical, then offer one short transfer/self-check.
4. **Retry:** preserve the actual first attempt and assistance/reveal state; do not turn a revealed retry into unaided mastery. Keep full-set coverage distinct from a short review.
5. **Unknown or unavailable:** say what is missing/disputed; keep canonical grading and saved progress unchanged. Source inconsistency must permit abstention, not a forced model justification.

### Curriculum coverage, not arbitrary volume

Every lesson needs a reviewed objective-to-task map. Use these task families where relevant; do not force all families into every micro-lesson.

| Skill | Required coverage across its reviewed sequence |
|---|---|
| Kana | Character-to-reading and reading-to-character recall, confusing pairs and short word application |
| Vocabulary | Meaning in context, reading recall, collocation/register and choosing or producing a usable sentence |
| Kanji | Contextual readings, character/word discrimination, meaning in a sentence and recall; no undifferentiated on/kun string as a complete lesson |
| Grammar | Form and constraints, meaningful contrasts, contextual choice, sentence construction/correction and short transfer production |
| Reading | Vocabulary support separated from answers, complete passage, evidence location, inference/reference tracking and concise explanation |
| Listening | Explicit comprehension objective, selectable replay, transcript revealed at the intended phase; dictation retained as a separate skill |
| Dictation | Persist attempted text, intentional reveal, reviewed orthographic variants and character/word feedback; separate self-rating from assessment |
| Writing | Task-specific content/grammar criteria, acceptable variants, response evidence, revision and explicit uncertainty |
| Kaiwa | Current question's communicative goal, appropriate register, paraphrase acceptance and criterion-level evidence; no acoustic/pronunciation claims from text |

Accessibility acceptance includes hiding the inactive flashcard face **and its controls** from accessibility navigation and keyboard focus, an explicit reveal control/state, and programmatically associated target text or range. Underlining alone does not identify a target nonvisually; do not disclose the tested reading in its accessible label. Announce selected/correct options and feedback without relying on color, and preserve separately numbered duplicate parts. Verify these exact states with keyboard and assistive technology; existing CSS visibility is not a substitute for that proof.

A lesson with three sound tasks is preferable to five padded ones. A longer sequence must demonstrate recognition, recall/application and transfer where its objective requires them. Single-purpose micro-lessons can remain narrow but must link to the wider coverage. Distractors need plausible learner confusions and a defensible unique choice; random unrelated strings do not count as diversity.

N5/N4 may use shorter Japanese and more Vietnamese scaffolding; N3 adds connected context and contrast; N2/N1 require discourse, register, nuance and defensible inference. These are review criteria, not claims that current corpus level tags certify sentence difficulty. All five levels remain mandatory deliverables.

### Runtime teaching, providers and safety

- Use the learner's **currently selected chat connection** plus canonical RAG/system teaching policies. Do not default to bulk static translation, silently choose another account/provider, or couple voice settings to chat.
- Keep reference teaching, pre-answer hinting and post-answer feedback as different modes. Share safety, evidence and level policy without forcing probe-first classroom dialogue into every reference explanation.
- Translate/teach from Japanese explicitly when a translation is missing. Preserve original text and provide an original/generated comparison. Label generated assistance; do not write it back as approved source content or an answer key.
- Keep requests explicit and focused. No background generation across thousands of lessons, automatic repair loops or bulk retries. Existing request/timeout limits are not a monetary budget; new live evaluation needs an identified free connection or an approved cost ceiling.
- Bound ordinary teaching by a focused field/output budget compatible with the selected provider. The current 64-field/48,000-character input limit can exceed a provider's output capacity, including the present 1,024-token Anthropic limit. Oversized requests must ask the learner to choose one word/example; no automatic chunking, retries or provider switch. Voice replay remains explicit and its provider/cost assumptions stay separate.
- Preserve canonical ID retrieval, JSON user envelopes, instruction/data separation, account/focus cancellation, scoped histories, stale-response ownership, plain-text output, original-option grading and independent voice configuration.
- Validate quantities, dates, negation, politeness, ambiguity and explanation relevance through independently reviewed semantic examples. Japanese-character preservation and valid JSON are necessary constraints, not semantic evidence.
- Known history/probe-injection and OAuth GPT-OSS schema-name issues remain separate unresolved workstreams; this plan does not certify prompt-injection immunity or unblock them.

### Progress and corrections

Retain old records. Represent at least: manual completion, attempted coverage, authored-key result, assisted/revealed result, self-assessment, AI advisory estimate and legacy/unknown evidence. Do not retrospectively infer assistance or mastery from fields never recorded.

Versioned corrections must map stable items and preserve old attempt revisions. Retired synthetic filler cannot donate its ID/history to a different new task. If a key/task is invalidated, retain its historical attempt with an explicit invalidated basis rather than silently rescoring it. Preview completion cannot certify the unattempted remainder of a full exam. Kaiwa estimates, raw workbook scores and self-report must retain their existing non-certification boundaries.

### Revision-bound requests and durable attempt evidence

The initial runnable cutover must bind **task ID, content revision, source collection and original position/option ID** through existing display, teaching, hint, answer and progress requests. Preserve tombstones/original slots instead of deleting entries and reinterpreting numeric focus. Reject stale or mismatched task revisions before inference or mutation; return an actionable reopen message. Include revision in response ownership, tutor continuity and cancellation so an open tab or late response cannot apply an old key to new content.

Extend the existing persistence path with a forward-compatible migration for per-attempt evidence. Current `progress_attempts` receipts and aggregate item rows cannot reconstruct this information, and shared flashcard/vocabulary item IDs cannot carry a single universal grading basis. Each new attempt must retain:

- Attempt/idempotency ID, stable task and item IDs, collection/original position, content revision and validity/disposition.
- Actual submitted option ID/original index or text; full quiz must submit its choice, not only a correctness boolean.
- Assessment basis, server-derived result where deterministically verifiable, assistance/reveal state and the relevant request/view ownership.
- First attempt versus retry and available timestamps. Unrecoverable historical fields remain `legacy/unknown`; no guessed backfill or silent historical rescoring.

Wire hints, reference/answer reveals and classroom/popover solution requests into the active attempt's assistance state **before help is displayed**. Do not claim an unaided result if assistance cannot be attributed reliably. An assist event itself must not alter correctness or completion.

Aggregation policy: objective accuracy uses only valid, revision-matched, deterministically verified attempts; assisted/revealed results are reported separately from unaided accuracy. Client-reported booleans, self-ratings, legacy/unknown records and AI estimates are not server-verified results. Attempted coverage counts actual submissions against fixed required task identities, separately from correct coverage and unavailable slots. SRS may retain explicitly labeled recall self-ratings as scheduling evidence, but they must not enter objective-accuracy/mastery totals; invalidated tasks contribute no new successful-assessment evidence. Manual completion remains independently named. Preserve old counters/history for legacy display rather than relabeling them as verified performance.

## 4. Dependency-ordered implementation slices

This is a proposed sequence, **not current ownership or authorization to edit other worktrees**. Declare exact paths and resolve shared-writer handoffs before each slice. Use existing branch/worktree isolation and coherent checked commits. No implementation slice is complete with only the screenshot example repaired.

| Slice | Scope / likely files | Dependencies and decisive acceptance |
|---|---|---|
| **A. Contract and critical-source disposition** | `static/jlpt-data.js`, `course/practical.json`, `workspace.js`, `learning.js`, `lesson-checks.js`, catalog builder; a focused editorial-corrections file only if needed | Establish typed task/option/stimulus identity and reviewed correction/quarantine records. The five confirmed original-task contradictions cannot be served for scored use; preserve original records and reject unavailable grading explicitly. Cover duplicates and star multiplicity. Freeze IDs/mapping before renderer changes. |
| **B. Clean adapter/catalog cutover** | `static/workspace.js`, `learning.js`, `study-plan.js`, `lesson-checks.js`, `scripts/build_teacher_catalog.mjs`; affected context selectors/tests | After A, migrate every existing consumer to the typed fields in one coherent cutover; remove obsolete overloaded fallbacks rather than keep two conventions. Source task counts/options/context survive all views and server catalog. No explanation-derived translation filler, wrong fallback skill or string-guessed example association. Generate catalogs in the owned worktree, not shared main. |
| **C. Render all task states correctly** | `static/app.js`, `practice.js`, `learning.js`, `study-teacher.js`, `teacher-context.js`, `index.html`; relevant existing styles only | After B, every listed learner surface retains required context/target. AI mounting cannot alter source rendering. Show actual task counts; distinguish translation and explanation; expose correct/selected options, feedback and card state accessibly. Verify actual browser behavior across all five levels and each applicable skill, including preview and full quiz. |
| **D. Teaching and feedback evidence** | `src/study-teacher.js`, `practice-coach.js`, `tutor-context.js`, `tutor-chat.js`, `prompt.js`, `static/study-teacher.js`, catalog field selectors | After B and compatible C controls, reference/hint/feedback each receive only appropriate evidence. Missing translation uses Japanese-source teaching; pre-answer content has no solution aliases. Maintain original/generated comparison, canonical grading, stale-owner protection and selected-chat/independent-voice routing. Source errors yield uncertainty rather than fabricated explanations. |
| **E. Assessment and progress semantics** | `static/learning.js`, `practice.js`, `study-plan.js`, `completion.js`, `app.js`, `src/worker.js`, `src/exams.js`; forward-compatible per-attempt migration in the existing persistence path | Include minimum revision/attempt compatibility in the initial runnable cutover, then complete durable evidence, submission/reveal tracking and tested legacy mapping. Writing checkboxes and dictation self-report cannot become objective accuracy. Separate preview/full coverage and aggregation bases; weak-item review opens canonical items. Preserve historical answers/SRS, unknown legacy evidence and independently named manual completion. |
| **F. All-level content/coverage remediation** | Reviewed authored content and versioned editorial overlays, per-level lesson/task declarations; original corpus snapshots remain untouched | After A/B, classify **every** audited lesson/source candidate: approved, needs revision, reference-only or blocked, with evidence and owner. Adjudicate all star/ambiguity candidates, practical task alignment, explanation quality and task diversity. Calibrate rubric on representative examples, then complete N5, N4, N3, N2 **and N1**; a small N5 pilot is not completion. No runtime model silently repairs keys. |
| **G. Calibrated teaching acceptance** | Existing teaching/assessment tests, reviewed evaluation cases and existing evaluation tooling only | After C/D/E and reviewed content, exercise every level/skill plus missing-context, duplicate-option, source-error, numeral/negation and history-boundary cases. Real-provider evaluation is separately authorized, isolated from real learner history and cost-bounded. Report semantic success, false positives, API failures and inconclusive cases separately. A second model's agreement is not human approval. |
| **H. Integrated rollout and closure** | Existing API/architecture/features/source documentation, existing release workflow | After all gates, verify the integrated head, data/answer mappings and actual learner UI. Obtain explicit merge/deploy and live-database authorization. Keep feature/content revision rollback compatible with retained attempts. Close only when every level's required scope is accounted for; otherwise publish exact blocked IDs and do not claim whole-app teaching quality. |

**One runnable cutover comprises A/B, regenerated catalogs, and every minimum C/D/E renderer, validator, selector and persistence change required to read the contract safely.** Do not publish an intermediate state whose old consumers require string answers/options or unversioned progress. This cutover includes eligibility enforcement, stable quarantined slots, stale-request rejection, correct option identity and assistance/revision recording. Later C/D/E slices may enrich behavior, but cannot contain prerequisites for basic contract compatibility or safe grading. The letters are dependency boundaries, not instructions to ship broken commits or keep compatibility shims. Parallelize only literal non-overlapping paths or ordered handoffs; F may split by disjoint level overlays after this contract is stable. Shared catalog, `app.js`, `learning.js`, `worker.js` and prompts retain one writer at a time.

The rollback target is the last compatible safe revision that retains revision guards, tombstones, rights/eligibility enforcement and known quarantine decisions. The defective baseline `204b55b` is evidence, **not** an acceptable grading rollback target. Newer attempts remain readable with their original revision and basis after rollback.

### Source-acquisition integration boundary

The independently owned `feature/vietnamese-learning-sources` stream has an earlier pushed metadata checkpoint `6de1df1` and is now extending acquisition/RAG. Its later unmerged work was not included in this baseline or semantically accepted by this audit. Current source claims cover `src/learning-rag.js`, `src/tutor-chat.js`, `src/study-teacher.js`, `src/practice-coach.js` and source documentation, so implementation slice D requires an explicit ownership handoff/integration order.

Treat acquired content as attributed, rights-qualified reference evidence, **not canonical grading authority**. User assertions of rights and publisher approval are different evidence. Reconcile admitted source IDs/locators, exact content revision and retrieval roles with A/B before integration; do not ingest, merge, recrawl or infer permission from this plan. Missing admission/quality evidence is an explicit source-level blocker, not a reason to invent material.

## 5. Verification and acceptance gates

### Contract and behavioral regressions

Use existing tests where they cover the path. Replace exact-five and answer-string-membership assertions with consumer-visible contracts, not weaker count checks or source-text tests.

| Existing test area | Required behavior to prove |
|---|---|
| `tests/lesson-flow.test.mjs`, `lessons.test.mjs` | Authored count/context/target preserved; no explanation-as-translation filler; original duplicate option identities and all full-exam positions retained; every level covered |
| `tests/tutor-ui.test.mjs`, `study-teacher-ui.test.mjs` | Passage/dialogue remains while answering; AI mounting preserves task rendering; actual selected/correct option visible; original/generated comparison and stale request ownership |
| `tests/study-teacher.test.mjs`, `teacher-context.test.mjs` | Correct source/role/revision/focus, including positions beyond the preview; reviewed numeral/negation and translation/task distinction fixtures |
| `tests/worker.test.mjs`, `prompt-security.test.mjs` | Hints omit all answer-bearing aliases; invalid/missing context blocks or abstains appropriately; AI errors do not grade or advance progress |
| `tests/kaiwa-rubric.test.mjs`, `kaiwa-security.test.mjs` | Current spoken question only; paraphrases accepted; quoted evidence is not judgment truth; estimates never become official scores/mastery |
| `tests/exams.test.mjs`, progress/lesson integration tests | Full-set coverage distinct from previews; corrected/retired tasks preserve prior attempt revisions; positional answers and legacy SRS survive; raw scores not JLPT certification |
| Focused learning assessment/accessibility tests only where existing coverage is absent | Writing/dictation evidence separated from self-report; meaningful keyboard/focus/status/target/card-state behavior, not DOM wiring alone |

For UI acceptance, run the actual application and inspect representative task states for **every level and every applicable skill/surface**, not only mocked payloads. Include keyboard/screen-reader evidence, answer reveal/retry, original/generated toggling, missing AI connection, slow failure, focus/account changes and full-question boundaries. Static inspection here does not establish accessibility conformance.

### Editorial acceptance

For each item released as assessed learning content, record reviewed objective, required context, target, unique defensible answer or explicit accepted variants, option/part identities, corrected complete sentence where applicable, rationale/evidence and distractor contrast. Review language level, naturalness, translation fidelity, task-aid alignment and licensing/provenance separately. Confirmed contradictions must be quarantined or corrected before scored use.

Review assistance must have a finite queue and outcomes, not “model checked everything.” The audit's per-lesson IDs and source-candidate locators provide the starting queue. Structural traversal covers every record; semantic acceptance requires qualified independent adjudication for published assessment content. Unreviewed imported reference material must remain accurately labeled rather than falsely certified. All N5–N1 coverage gaps require disposition; do not silently defer advanced levels.

### Model and learning-quality acceptance

Before any new live run, freeze a finite reviewed set, expected acceptable variants, assistance phase and pass/fail criteria. Include correct and incorrect learner answers, answer-equivalent hints, missing/conflicting source evidence, false-friend distractors, all skill families, all levels and adversarial evidence. A legitimate learning request must remain answerable; API/quota errors are not security passes or pedagogical failures.

Use the exact application request path and selected provider/model, with isolated history/progress, logged nonsecret parameters, finite request count and approved cost boundary. Report correct teaching/feedback decisions, answer leaks, false refusals, wrong grading suggestions and inconclusive/API cases with explicit denominators. Add independent teacher review and representative learner comprehension/retry tasks before claiming pedagogical effectiveness. No finite benchmark proves universal injection resistance or learning outcomes.

### Release/rollback gates

- No pre-answer answer leakage from reference/rationale aliases in controlled contract cases.
- No lost passage, target, source option identity, unknown-key forced grading or misleading actual count.
- No unadjudicated confirmed defective question in scored use; candidates have explicit dispositions.
- Required skill coverage and reviewed feedback present across all five levels, not solely increased question volume.
- Assistance, self-report, objective evidence, manual completion and estimates remain distinguishable in persistence and UI.
- Current providers, independent voice, existing histories and stable progress remain intact; authorized sources only.
- Exact integrated-head checks and real UI evidence recorded. Deployment/migrations remain separately approved.
- Rollback disables the new presentation/content revision without deleting attempts or remapping their meaning. Never roll back by re-enabling known invalid keys as graded questions.

## 6. Completion state and open decisions

**Completed in this checkpoint:** baseline/scope ownership; full finite structural inventory; source-to-UI-to-AI/progress dependency inspection; AI editorial examination of all original exam questions and practical units; defect/candidate separation; this dependency-ordered remediation plan.

**Not completed or claimed:** product fixes, full-corpus Japanese semantic approval, real-provider teaching/injection measurement, learner-outcome evidence, assistive-technology acceptance, source-ingestion approval, new content admission, migration application, PR/merge or deployment.

Implementation must name an owner and coordinate the active source workstream before editing shared paths. Qualified editorial capacity, disputed Japanese answers, source admission and separately authorized live evaluation are explicit dependencies. Existing canonical IDs/indices, learner history, selected chat connection and independent voice are non-negotiable preservation constraints.

## 7. Runnable implementation checkpoint

Implemented on `feature/teaching-quality`, based on `e9b2c4e` (the approved plan and committed `fc34877` source/RAG runtime). The dirty main checkout and other worktrees remain untouched. Later source acquisitions and the independently owned N5 editorial file are not silently copied or treated as approved assessments.

### Delivered technical scope

- **A/B:** one typed normalization path for the browser and generated catalogs. Source translation, rationale, passage/dialogue, instruction, lexical target, arrangement parts and original numeric option identities remain distinct. No fixed-five filler or explanation-derived quiz examples. All five confirmed defective star questions remain unavailable at their original positions.
- **C:** shared lesson/practice/full-quiz rendering retains required context and real counts. Duplicate option strings retain separate source positions. Native choice, typed recall, writing and dictation are executable; writing/dictation no longer fall through into generic recognition questions. Manual completion is explicitly a personal marker. Flashcard hidden faces and feedback have accessible state.
- **D:** task-bound teaching, hints, classroom/popover and read-aloud reject stale/quarantined/prohibited references before provider use. Selected-chat teaching retains original/generated comparison and independent voice. Pre-answer evidence omits solution aliases; post-answer explanations retain the actual submission and source basis. Missing Japanese-source translations remain on-demand teaching, not bulk corpus rewriting. Bounded requests fail visibly without automatic provider retries.
- **E:** migration `0022_task_attempt_evidence.sql` and the existing progress route retain task/revision, actual submitted option/text, assistance/reveal snapshot and assessment basis. Post-answer assistance does not rewrite the original attempt basis. Random account epochs fence pending writes across reset, deletion and account recreation. Legacy counters/SRS stay readable without retroactive verified labels or rescoring.

The cutover uses existing adapters, catalogs, APIs and progress storage rather than a second grading system. Superseded string-answer/fixed-five consumers were removed in the owned scope; no unrelated module rewrite was needed.

### Exercised checks

- Final UI/catalog/source/voice check: `node --test --test-concurrency=2 tests/tutor-ui.test.mjs tests/study-teacher-ui.test.mjs tests/task-contract.test.mjs tests/lesson-flow.test.mjs tests/lessons.test.mjs tests/teacher-context.test.mjs tests/chat-ui.test.mjs tests/speech.test.mjs` — **115/115 passed**.
- Backend/ownership/provider regression set: `node --test --test-concurrency=2 tests/task-attempts.test.mjs tests/worker.test.mjs tests/tutor-context-boundary.test.mjs tests/tutor-session.test.mjs tests/study-teacher.test.mjs tests/tutor-ui.test.mjs tests/study-teacher-ui.test.mjs tests/api-profile-backend.test.mjs tests/antigravity-oauth.test.mjs` — **217/218 passed**. The remaining fixture created a second session without its profile; the fixture now creates both. Its exact rerun, `node --test --test-name-pattern="generated exercise labels survive" tests/worker.test.mjs`, passed **1/1**. These commands overlap; their counts are not a unique combined test denominator.
- `npm run build` — catalog generation and Worker/static **dry-run succeeded** after the final behavioral edit. It generated 454/429/862/866/1,302 canonical lessons for N5/N4/N3/N2/N1. This did not apply a live migration or deploy.
- Actual Edge browser used the real Worker and all migrations against disposable in-memory D1, with synthetic registration and external/provider network disabled. Source question targets and original numeric options were inspected at all five levels. N3 set 1 kept four slots, marked 提出, retained its reading passage and refused to grade the defective star slot or claim full completion. N1 set 2 retained separately addressable second/fourth `あれ` options.
- Real UI submissions saved a writing response and checklist as self-report, a dictation response with immutable pre-reveal snapshot, and typed kana recall (`ya`) as source-advisory evidence. Verified answers remained zero. Dictation/mobile rendering at 390 px had no horizontal overflow. Browser diagnostics contained blocked external font/Google-sign-in loads, not observed JavaScript exceptions. No real speech generation, live-model teaching or full assistive-technology certification is claimed.
- In-scope code review findings were fixed and covered: missing listening playback, dictation edits during reveal persistence, feedback coaching before answer acknowledgement, nested restricted-reference processing, late assistance races and evidence recreation after reset/deletion.

### Remaining gates: not whole-application pedagogical completion

**F remains open.** Source-grounded recall is executable, but that does not replace independently reviewed contextual transfer, contrastive feedback and objective alignment for every N5–N1 lesson. Unreviewed material remains labeled advisory/reference; the five defective source questions have no invented replacement keys. Independent N5 content work is a separate committed handoff dependency, not evidence of N4–N1 completion.

**G remains open.** A finite reviewed teaching set, qualified Japanese/editorial adjudication, real-model semantic evaluation, representative learner comprehension and actual assistive-technology acceptance are still required. Synthetic provider tests and source-key agreement cannot certify teaching quality or universal injection resistance. No new paid inference or provider/account change was made.

**H is not authorized by this checkpoint.** Publish the coherent checked task branch only. Integration, production D1 migration, PR/main merge and deployment require their separate approvals and integrated-head checks. Preserve historical attempt revisions, source option identities and quarantine decisions during any future rollout or rollback.
