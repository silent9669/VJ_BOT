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

## 8. Committed N5 editorial handoff integration

After publishing the runnable cutover as `f1e534c`, the canonical implementation owner accepted source handoff `bde3132`. Its committed source-only changes were merged into the isolated task branch; no unfinished source-worktree files or authored payloads were copied/rewritten. The source asset's staging/integration description records its original editorial checkpoint; this section records subsequent canonical consumption without inventing human approval.

The existing N5 loader now admits twenty prerequisite-ordered AI-authored packages: **100 contextual examples, 40 common-error contrasts and 100 authored tasks (60 choices, 40 constrained-text)**. They appear in the existing curriculum and grammar library, with source/AI/advisory labels. Examples retain context and readings; reference disclosures show contrastive corrections. Normalized tasks preserve each authored task/item ID, source option position and explicit provisional text variants, without an added sixth formation question. Existing teacher/catalog/coaching/progress paths serve them; no parallel application or assessment authority was introduced.

The catalog retains AI authorship, background-reference citations, `human_approved:false`, `scored_assessment:false` and `mastery_credit:false`. Source comparison remains advisory. Curriculum attempted coverage requires an actual submission at the current task revision, deduplicates retries and stays separate from manual completion and verified results. The existing evaluator recorder was also migrated to canonical question task/revision references and response-echo checks; loopback/no-clobber/secret protections and human-review-required results remain intact.

### Actual verification

- `node --test --test-concurrency=2 tests/*.test.mjs` ran **663 tests: 657 passed, 6 failed**. Failures identified one incomplete authenticated test fixture and obsolete answer-exposing/fixed-five grounding/evaluator assertions. Those direct contract consumers were migrated rather than restoring defective behavior.
- After those corrections, `node --test --test-concurrency=2 tests/prompt-security.test.mjs tests/tutor-grounding.test.mjs tests/tutor-evaluation.test.mjs` passed **30/30**, including wrong-task response rejection and guarded recorder modes. The remaining full-run results apply to unchanged relevant code; this is not a fabricated second full-suite run.
- Full-run coverage included the new twenty-package catalog/identity/variant/prerequisite consumer test, revision-bound attempted-coverage test and real-Worker N5 hint/submission/advisory test. Independent scoped TypeScript/security reviews found no concrete introduced issue, including the later evaluator migration; reviews did not substitute for test execution.
- Actual Edge/Worker/disposable D1 showed the twenty-lesson chapter and its source/AI limits, contextual examples/readings and error disclosures. A deliberately wrong original option remained in evidence; keyboard-submitted `わたしはきょうしです。` matched an explicit provisional variant. Completing five tasks displayed **4/5 source matches**, **verified answered 0**, and curriculum **“Đã thử 5/5 · tham khảo”** while personal chapter completion remained **0/20**.
- The synthetic upstream returned unusable replies on two explicit hint clicks; both HTTP 503 errors remained visible, without automatic generation, invented help or blocked ordinary practice. These are API/fixture failures, not model-quality successes or injection blocks. The backend N5 regression separately exercised valid synthetic hint/feedback responses on the actual Worker path. No real provider/model inference, cost, voice/configuration change to a real account or learner-data mutation was performed.

The all-level editorial/model/learner/assistive-technology gate remains **blocked**, not satisfied by N5 content volume or finite technical checks. N4–N1 content dispositions and independent language/learning acceptance remain explicitly in scope and unresolved. Merge/deployment and production migration remain separately authorized operations.

Final phase-2 `npm run build` regenerated **474 N5 canonical lessons / 4,812 N5 progress items** and succeeded in Worker/static dry-run; N4/N3/N2/N1 lesson counts remained 429/862/866/1,302. This is build evidence only, not a deployment or production migration.

## 9. User-review draft expansion across advanced levels

The user explicitly instructed continued implementation and will evaluate quality **before merge**. Missing human approval therefore does not block reachable drafting or technical integration. It still blocks claims of independently accepted pedagogy, scored mastery and an approved release. The historical gates above are not permission to stop drafting or to fabricate approval.

This checkpoint adds one contextual draft package for each of the fourteen existing N4–N1 practical objectives: N4 lateness/leave/fictional clinic language/booking/instructions; N3 repair/suspicious-email reading/handover/experience; N2 policy/comparison/proposal; N1 argument/synthesis. These are original AI-authored practice drafts based on VJBot's existing original scenarios, not copied publisher exercises or certified JLPT-level materials. Original corpus, scenario records, task keys, historical attempts and five quarantined questions remain unchanged.

The existing N5 admission path is parameterized by level, preserving every published N5 identity. All packages use the existing curriculum, lesson/practice renderer, canonical catalog, selected-chat teaching, task revisions and advisory evidence. Task-specific passages, conditions and explicit writing constraints are preserved while answering; explanations contrast the actual alternatives instead of treating a valid JSON response as pedagogical correctness. Native constrained-text tasks retain explicit provisional variants and do not claim to enumerate every valid Japanese utterance.

No provider, account or voice configuration is changed for real learners. No paid inference, installation, source crawling, production migration, PR merge or deployment is part of this checkpoint. Finite technical and independent AI review support preparation for the user's review, not a claim that every imported OpenJLPT lesson has been independently rewritten or certified.

### Draft inventory and exercised verification

- New draft counts: **N4 5 lessons / 25 tasks / 15 examples / 10 common errors; N3 4 / 20 / 12 / 8; N2 3 / 15 / 9 / 9; N1 2 / 10 / 8 / 6**. Total: fourteen lessons, seventy tasks (forty-two choices and twenty-eight constrained-text responses), forty-four examples and thirty-three error contrasts. The existing twenty N5 packages are unchanged.
- Independent AI review covered all new lessons, tasks, examples and common-error contrasts. The identified N1 example had dropped the beneficiary qualifier `多くの人` and weakened translation alignment; Japanese, reading and Vietnamese now preserve that qualifier and modality. Review provenance is explicitly AI-only, not human approval. Scoped runtime review found no concrete introduced defect. Its generated-asset freshness caveat was resolved by the final canonical prebuild.
- `node --test --test-concurrency=2 tests/task-contract.test.mjs tests/lessons.test.mjs tests/lesson-flow.test.mjs tests/tutor-ui.test.mjs tests/study-teacher-ui.test.mjs tests/study-teacher.test.mjs tests/worker.test.mjs tests/tutor-grounding.test.mjs tests/tutor-context-boundary.test.mjs tests/tutor-session.test.mjs tests/prompt-security.test.mjs tests/learning-rag-integration.test.mjs tests/teacher-context.test.mjs tests/speech.test.mjs` passed **239/239**. This includes all-level authored ID/variant/passage preservation, rejection and retry of falsely approved/mismatched packages, and the actual Worker hint/answer/feedback/advisory path for each level.
- After the N1 source correction, `node --test --test-name-pattern="all-level draft packages" tests/task-contract.test.mjs` passed **1/1**. This overlaps the larger set and is not an additional unique-test denominator. No second whole-suite run is claimed.
- Final `npm run build` regenerated canonical catalogs and completed Worker/static dry-run: N5 **474 lessons / 4,812 progress items**, N4 **434 / 4,432**, N3 **866 / 10,439**, N2 **869 / 10,508**, N1 **1,304 / 17,290**. These ignored generated assets are rebuilt by the existing hooks; this was not a deployment or live database migration.
- Actual Edge used the real Worker, all migrations and disposable in-memory D1, with external/provider networking disabled. All fourteen new overviews displayed their authored contexts, Japanese examples, error contrasts and AI-review limits. Each level's first draft task retained its actual count and numeric options; advanced passages remained visible. N1 common-error disclosure and the corrected beneficiary example were inspected on the rendered surface. A 390 px advanced-task viewport had no horizontal overflow.
- A deliberate synthetic hint failure returned HTTP **503** once; one explicit user retry returned **200**. No automatic retry occurred. Subsequent synthetic feedback and teaching requests returned **200**. Original/generated comparison preserved the actual question, option positions and selected wrong answer. This proves request/UI handling only, not real-model quality, correct semantics or injection resistance.
- Four actual N1 submissions retained original choices and a keyboard-submitted constrained Japanese response. Isolated progress showed **source-advisory 4 answered / 3 matches / 1 nonmatch; verified 0**, one assisted attempt and three assistance-unknown attempts. Later feedback/teaching did not rewrite the first attempt's original selection or assistance classification. Curriculum displayed **“Đã thử 4/5 · tham khảo”** while personal chapter completion remained **0/2**.

User review before merge, broader imported-lesson editorial acceptance, real-model semantic evaluation and actual learner/assistive-technology acceptance remain distinct open gates. Finite reviewed drafts and successful synthetic checks do not establish whole-application pedagogical completion.

## 10. Additive N5 practical-objective drafts

The next bounded checkpoint adds six original guided supplementary N5 packages: introductions, ordering, time, transport, shopping and asking for help. They reuse `static/course/n5-teaching.json`, the existing all-level loader, canonical curriculum/catalog and advisory attempt path. No second loader, task schema, grader or provider route is added.

The new packages add **30 tasks (18 choices, 12 constrained-text responses), 18 contextual examples and 12 common-error contrasts**. Together with the advanced checkpoint, all twenty original N5–N1 practical-unit IDs now have exactly one contextual draft mapping. This accounts for those finite practical objectives, not every imported corpus record. Every original twenty N5 lesson object and its hundred canonical task revisions remain unchanged.

New source notices explicitly limit use to guided supplementary practice. Constrained reconstruction and exact task-bound variant comparison do **not** establish learner-chosen communication, meaning/structure/orthography diagnosis or suitability as a primary beginner self-study course. The separately recorded N5 production-transfer, error-dimension, prerequisite/sequence and te-form scaffolding remediation requirements remain unmet by this content-volume slice. User quality review still precedes merge.

Two independent scoped AI reviews covered the six new explanations, eighteen examples/readings/translations, twelve error contrasts and thirty tasks. No concrete consumer-visible issue was reported. The second review first failed before execution because Windows denied an account-warmup lock; one contained serial restart after the sibling settled completed normally, without reading credentials or changing accounts, configuration, permissions or providers. Review provenance remains AI-only and does not constitute human approval.

### Exercised additive-checkpoint verification

- A throwaway in-memory consumer compared the committed `990b793` N5 asset with the additive asset: all **20 original lesson objects and 100 canonical task revision inputs were identical**. Only six new packages and truthful package-level integration metadata were added; historical review records remain historical.
- `node --test --test-concurrency=2 tests/task-contract.test.mjs tests/lessons.test.mjs tests/lesson-flow.test.mjs tests/worker.test.mjs` passed **92/92**. It covers every original practical-unit source mapping exactly once, all admitted authored task identities/variants/passages and actual safe hint/wrong-choice/feedback/text/advisory/stale-revision paths for each new N5 package.
- Final `npm run build` regenerated **480 N5 lessons / 4,842 N5 progress items** and completed Worker/static dry-run. Other level counts remained unchanged. No deployment or production migration occurred.
- Actual installed Edge used a fresh disposable account, the real Worker and all migrations on in-memory D1. All six overviews displayed their context/examples/error contrasts and supplementary-use notice. Actual clicks and keyboard text entry submitted all thirty new tasks. The deliberately wrong original option remained saved as index **2**; progress reported **30 source-advisory answers / 29 source matches / 1 nonmatch; verified 0**, one assisted and twenty-nine assistance-unknown attempts.
- The six new chapter entries each showed **“Đã thử 5/5 · tham khảo”** while personal chapter completion remained **0/26**. The new time passage and original numeric options rendered at 390 px without horizontal overflow. Browser diagnostics contained blocked external font/Google-sign-in requests, not observed JavaScript exceptions.
- One deliberately failed synthetic hint returned **503**, followed by **200** only after an explicit retry. Both the browser and test provider were explicitly synthetic; no real provider/model inference, semantic model-quality success, acoustic validation, learner comprehension or free-communication acceptance is claimed.

## 11. Operator-directed N5 learning-cycle corrections

The operator's subsequent review rejected this as a primary beginner self-study curriculum and retained the teaching-quality workstream as sole implementation owner. This checkpoint addresses the five recorded N5 corrections rather than treating the earlier package counts as pedagogical completion. Guided supplementary use, AI authorship, no human approval and no mastery certification remain explicit.

### Responsibility and data flow

- The existing N5 asset retains every published task/option ID and original source position. New tasks append rather than replace old slots. Original twenty lessons now declare instructional revision 2, explicit task objectives and local support. Their objective-bearing canonical task revisions deliberately change; historical attempts are retained, not silently rescored. Unannotated non-N5 tasks retain their prior revision serialization.
- `lesson-checks.js`/the existing loader/catalog bind objective and exchange metadata to the task revision. `practice_path` selects stable IDs without reindexing the canonical inventory. The existing practice renderer now accepts open writing and retains original typed text, one practice-session UUID, accessible controls and post-answer coaching only after the answer receipt.
- Invitation task `:5` tests understanding of a new short dialogue; `:6` asks the learner to choose an activity and produce an invitation without a supplied verb, sentence or key. Tasks `:7`/`:8` continue the actual saved invitation through explicitly authored alternative acceptance/refusal branches. Original `:0–:4` remain separately labeled constrained rehearsal. Task `:9` is a different held-out neighborhood invitation, absent from default practice.
- `src/task-response.js` is the single server comparison helper for progress/coaching. Literal source matches, objective-aware cosmetic differences and unassessed writing are distinct. It never rewrites text/keys or verifies meaning/grammar. Feedback receives the actual submission and task-specific criteria; meaning/structure/orthography uncertainty stays explicit. A missing final `。` or harmless Japanese spacing does not become a grammar-error claim; question marks, negation, quantities and ASCII token boundaries are not broadly stripped.
- Migration `0023_learning_sessions.sql` adds nullable session/feedback fields to existing attempt evidence, preserving old absent-session identities and epoch/reset/deletion protection. Bound coaching validates actual user/task/revision/index/text/session, retrieves only canonical earlier same-session invitation evidence and retains successful advisory feedback. Epoch guards run before generation and successful responses, including unbound legacy feedback. Session answer timestamps establish server ordering, not human response time.
- Later review requires all three current-revision production/continuation answers in one different completed session, each at least 24 hours old. Earlier answers are withheld from its evidence. Private progress exposes actual original response/time/revision/session/help and feedback. The task-addressed review URL restores the standalone exercise after reload without mounting lesson/model-answer reference content.

### Beginner prerequisite versus just-in-time support

All twenty original objectives/examples received a concrete support disposition, not only an acyclic graph check. There are 61 local support entries. A supplied phrase or vocabulary explanation is not represented as a previously mastered grammar topic.

| Lesson ID suffix | Prior conceptual basis | Local support or preparatory activity |
|---|---|---|
| `topic` | None | Kana, topic/predicate and occupation/family words. |
| `also` | Topic | Early `これ・それ`, supplied `の` phrase and noun negation. |
| `possession` | Topic | `これ` versus `この／その` and ownership question. |
| `question` | Topic, possession | Question words, calendar and place words. |
| `polite-verbs` | Topic, question | Supplied verb inputs, `を／に` and time cues. |
| `past-negative` | Polite verbs | Group-dependent `ない` formation and irregulars before `なかった`; new source positions 5/6 precede the original tasks. |
| `te-form` | Polite verbs | Dictionary group information and small worked-example/attempt stages. |
| `request` | Te-form | Roles, verb groups and place phrases. |
| `negative-request` | Polite verbs, past-negative, te-form, request | `ない` recap, manner/contact phrases. |
| `existence` | Topic, possession, polite verbs | `に／で`, `が／は`; plants and parked vehicles still use `あります`. |
| `time-range` | Polite verbs, existence | Time/day/journey words and locally supported reason phrase. |
| `action-place` | Polite verbs, existence | Events versus existing objects; location phrase. |
| `invitation` | Polite verbs, question, time-range, action-place | Acceptance/refusal phrases, hypothetical branches and rehearsal versus production. |
| `reason` | Topic, polite verbs, time-range, action-place, existence | Predicate/adjective support and `何も` with negation. |
| `comparison` | Topic, possession | Explicit `い／な` predicate/adnominal foundations and preference/range; new source positions 5/6 precede comparison tasks. |
| `want-action` | Polite verbs, comparison | `たい` formation and legitimate `を／が` variants; desire is not completed action. |
| `want-object` | Topic, want-action | Supplied modifiers and wanting an object versus wanting to buy it. |
| `demonstratives` | Topic, question, possession, comparison | Full demonstrative system, speaker shifts, adjectives/prices. |
| `choice` | Polite verbs, question, demonstratives, want-object | Choosing versus merely wanting or having consumed something. |
| `after-action` | Te-form, polite verbs | Recipient/place phrases, groups and sequence rather than assumed causation. |

Te-form now has nine small stages and ten actual tasks, in source-position order **5, 6, 7, 1, 8, 0, 9, 3, 4, 2**: group identification, group 2, group-1 `む`, contrasting `る`, `く／ぐ`, `する`, `来る`, exceptional `行く`, then function/time. Worked examples differ from the exercise answers. Full original tables/functions/time notes and examples remain accessible in collapsed reference disclosures rather than compulsory first-screen exposition.

### Actual verification and review

- Integrated command: `node --test --test-concurrency=2 tests/task-contract.test.mjs tests/task-attempts.test.mjs tests/worker.test.mjs tests/tutor-ui.test.mjs tests/navigation.test.mjs tests/lessons.test.mjs tests/lesson-flow.test.mjs tests/study-teacher-ui.test.mjs tests/study-teacher.test.mjs tests/tutor-context-boundary.test.mjs tests/tutor-session.test.mjs tests/prompt-security.test.mjs tests/speech.test.mjs` ran **261 tests: 256 passed, 5 failed**. All five newly added UI tests selected the hidden reference-start button instead of the activity's action. Selectors were corrected to `.practice-session .practice-primary`; their consumer assertions were retained.
- After scoped frontend and security-review fixes, `node --test --test-concurrency=2 tests/tutor-ui.test.mjs tests/worker.test.mjs tests/learning-rag-integration.test.mjs` passed **122/122**. This includes writing feedback without choice aliases, account-switch privacy, restart focus/new sessions, cosmetic versus semantic differences, same-session/24-hour guards, paused-retrieval epoch invalidation and bound/unbound reset/delete/recreate races. The direct RAG fixture now creates the required authenticated learner profile. Counts overlap; this is not a second full-suite run.
- Canonical prebuild/Worker/static dry-run succeeded with **480 N5 lessons / 4,856 N5 progress items**; other level counts stayed unchanged. A final style-only neutral-status/native-textarea adjustment is separately checked on the actual surface. No production migration or deployment occurred.
- Independent scoped content review found no retained language/support issue. A delayed-prerequisite finding was withdrawn after inspecting the clarified cross-session contract. TypeScript review identified writing-response aliases, account-owned run state and lost restart focus; all were fixed with meaningful UI regressions. Database review found no concrete SQL/session issue. Security review identified pre-generation and unbound late-response epoch gaps plus an incomplete direct-consumer fixture; each was fixed and covered. These are AI reviews, not human approval.
- Actual Edge/real Worker/in-memory D1 completed comprehension and all three learner-chosen invitation branches. It retained the raw invitation including outer spaces, actual continuation texts, one UUID session, three `self_report`/null-correct writing answers, zero verified answers and bound advisory feedback. No verb/model/key was supplied for those open responses; partner replies were visibly labeled authored hypothetical branches.
- Actual source practice distinguished raw ` 私 は 教師です ` as neutral cosmetic difference from `私は教師だです。` as a different reference with explicit semantic uncertainty. Both retained literal nonmatch and original text. Every original lesson's support/prerequisite surface was inspected; early demonstrative support was opened. Actual comparison/past-negative practice began at their preparatory canonical position 5.
- All ten te-form tasks were submitted through real controls, including wrong group choice and `見って`. Specific source corrections appeared before progression; subsequent text tasks used keyboard entry. Full reference started collapsed and source positions remained unchanged.
- The delayed control was initially disabled. **Only the disposable fixture** then shifted its completed session timestamps by 25 hours; no real learner waited 25 hours. The actual due button opened canonical task 9 in a fresh session; reload preserved the standalone route, no old invitation/model answer was displayed, and new response/feedback/time/revision/session evidence persisted with null source correctness. Assistance remained unknown rather than falsely unaided. This proves state handling only.
- At 390 px, actual keyboard-saved open writing had a full-width native textarea, visible action focus and neutral unassessed feedback (`rgb(240,243,237)`), not an inherited red error cue. No horizontal overflow or unexpected JavaScript exceptions were observed; external font/Google-sign-in loads were intentionally blocked.

**Still not established:** independent human approval, real selected-model semantic feedback accuracy, actual later-session unaided learner retention/transfer, microphone/audio quality and full assistive-technology acceptance. The delayed-learning gate remains open for actual learner evidence. User quality review still precedes merge; no PR/main merge, deploy, live D1 migration, paid inference, installation or real account/provider/voice change was performed.

## 12. All-level learning cycles and remaining source dispositions

The user's instruction to continue all remaining implementation extends the existing canonical learning cycle across **all forty authored N5–N1 packages**, rather than treating the N5 invitation as the only open-production lesson. This is a reachable implementation scope, not a claim to have independently rewritten or semantically approved all 10,720 imported source records. Imported tasks remain explicitly unreviewed/source-advisory; original source records, positions, options, keys and historical attempts are preserved.

### Authored content and shared runtime

- Thirty-nine packages append **117 executable writing tasks**: learner-selected production, continuation/revision using the actual preceding response, and a different-context held-out review. The existing invitation lesson remains unchanged, including its explicitly alternative acceptance/refusal branches. Every lesson now has that complete learning-cycle coverage through the same catalog, renderer, coaching and private attempt/session routes.
- Current inventories: **N5 26 lessons / 219 tasks (83 choice, 57 constrained-text, 79 writing); N4 5 / 40; N3 4 / 32; N2 3 / 24; N1 2 / 16**. Advanced levels together retain 42 choices and 28 constrained-text tasks, plus 42 new writing tasks. These are activity counts, not accepted learning outcomes or unique human assessments.
- Prerequisite concepts are distinct from **112 local support entries** across all levels. Six practical N5 packages now point to relevant concept prerequisites instead of an arbitrary practical-package chain. N5's nine te-form stages and original source-position path prefix remain intact; four additional worked stages support constrained N4/N3 practice, not open or held-out answers.
- `produce` has no prior answer; `respond` and `revise` resolve only canonical prior text in the same owned session. A correct original may be retained with an explanation; static editorial follow-ups do not pretend to be personalized AI conversations or force an error. Delayed eligibility requires the complete current-revision production/continuation cycle in one different prior session and all required responses at least 24 hours old. Old responses are withheld from held-out model evidence. UI due-state now agrees with the server when an older eligible cycle coexists with a newer not-yet-due retry.
- Open production has no answer string, source model or deterministic semantic grade. Actual response text, revision, session/time, assistance and optional advisory feedback remain separate. Native writing and dictation now retain raw outer spacing as well. Legacy text tasks receive bounded cosmetic-versus-reference diagnostics without silently changing historical task hashes or inferring grammar correctness.
- **Criteria are post-answer self-check material.** Independent AI review found forms/reflection explanations in visible pre-answer N5 criteria, and a calculated date in one N2 criterion. The shared renderer now withholds writing criteria until successful answer acknowledgement; failed/pending saves do not reveal them. Hints omit criteria, while feedback receives them after an answer. The N2 date criterion itself now requests the derivation without supplying the answer. Instructional prompts still state the real task and constraints.
- Runtime review found four N1 annotations and one N2 annotation outside the frozen objective vocabulary. They now use the existing `meaning` objective, not a second assessment schema. A valid 4,000-character current answer plus its actual 4,000-character parent no longer fails merely because diagnostics repeat the same text: model evidence is deduplicated, receipts retain raw text, and focused limits are explicitly 16,000/20,000 characters before/after retrieval.

The parent compared every pre-existing authored task at its original index against published `67b60f0`: all **214 prior task payloads** retain IDs, prompts, options, keys, variants and rationales; only newly added objective metadata was omitted in the comparison, and pre-existing objective values remained equal. The entire invitation lesson was identical. New criteria/metadata intentionally produce new task revisions, not retroactive rescoring.

### Finite source candidates: disposition without invented corrections

The original five confirmed contradictions remain unavailable. A read-only independent AI review also examined every remaining candidate from section 2:

| Original source ID | Evidence and current disposition |
|---|---|
| `N1:1:3` | Its stored star position agrees with its explanation, but `ある極まりない` remains an unresolved construction/naturalness candidate. Unavailable pending qualified adjudication; not relabeled as a confirmed positional contradiction. |
| `N4:1:2` | Both `おくれて` and `とまって` fit the accident context. The unique key is not established, so no advisory/scored answer or justification is offered. |
| `N5:1:5` | An alternative complete order `にほん・へ・ともだちと・ひこうきで` changes the star choice while retaining the stated destination/companion/transport. Unavailable as a unique-star task. |
| `N5:2:3` | `スーパーで・たくさん・りんご・を` uses every supplied part and changes the star choice. Unavailable as a unique-star task. |
| `N4:2:3` | `心を込めて・新鮮な・野菜を・使って` uses every supplied part and changes the star choice. Unavailable as a unique-star task. |

These alternatives are evidence against established uniqueness, **not replacement gold answers or human approval**. All ten unavailable slots keep their original source identity, position, options and key; answer/hint/evaluation/processing capabilities are disabled and the fixed full-set denominator is unchanged.

Two practical boundaries are also resolved without overwriting originals:

- `practical:v1:N4:late`: its written model meets the written prompt, but not the separate spoken question asking current location and arrival time. Written production no longer inserts `question_jp` as its instruction. All practical speaking prompts stop reusing broader writing prompts/criteria as fake Vietnamese translations/hints. Missing gloss/hint state is explicit; selected-chat teaching uses the actual Japanese question on demand.
- `practical:v1:N2:policy`: the original model's `来月から` omits the explicit first day in `来月一日から`. That model remains in the immutable source but is withheld from normalized writing/model evidence, overview teaching and learner reveal. The actual writing activity remains available with an explicit precision limitation and no invented corrected model. Unrelated unit questions remain available.

### Exercised checks and actual application proof

- Integrated command: `node --test --test-concurrency=2 tests/task-contract.test.mjs tests/task-attempts.test.mjs tests/worker.test.mjs tests/tutor-ui.test.mjs tests/study-teacher-ui.test.mjs tests/lessons.test.mjs tests/lesson-flow.test.mjs tests/navigation.test.mjs tests/study-teacher.test.mjs tests/tutor-context-boundary.test.mjs tests/tutor-session.test.mjs tests/prompt-security.test.mjs tests/learning-rag-integration.test.mjs tests/teacher-context.test.mjs tests/speech.test.mjs` ran **294 tests: 290 passed, 4 failed**. Failures exposed the remaining N2 objective annotation, absent-versus-empty model assertion, an invalid Japanese-source synthetic translation fixture and a new all-package test exceeding the real per-user rate limit. The fixture now preserves Japanese source text, absent models remain absent, and representative inference checks are bounded while every package still exercises actual persistence.
- After those fixes and the criteria-phase regression, `node --test --test-concurrency=2 tests/task-contract.test.mjs tests/task-attempts.test.mjs tests/tutor-ui.test.mjs tests/study-teacher-ui.test.mjs tests/worker.test.mjs` passed **184/184**. This includes all forty canonical production/continuation/later persistence paths, ten unavailable original slots rejecting before inference/mutation, current-account/session/revision ownership, long-response feedback and pending/failed-save criteria concealment.
- A final small speaking missing-gloss/hint correction was covered by `node --test tests/lesson-flow.test.mjs` — **7/7 passed**. Both commands overlap the initial set; no new full-suite denominator or second full-suite pass is claimed.
- Final `npm run build` succeeded, including canonical catalog generation and Worker/static dry-run: N5 **480 lessons / 4,931 items**, N4 **434 / 4,447**, N3 **866 / 10,451**, N2 **869 / 10,517**, N1 **1,304 / 17,296**. This did not migrate or deploy.
- Actual installed Edge used the real Worker and all migrations on disposable in-memory D1, with external/provider networking disabled. All **40 authored overviews and their first canonical task** were inspected at the correct level/ID. Representative complete cycles at N5 topic, N4 lateness, N3 repair, N2 policy and N1 argument submitted **35 actual activities**: five deliberate source nonmatches, twenty source matches and ten independently authored writing responses. Each continuation displayed the exact prior text and one private session; criteria were absent before submission and visible after acknowledgement. Synthetic bound feedback persisted separately; verified results remained zero.
- Those five reviews were initially not due. **Only the disposable fixture** shifted the five completed session timestamps by 25 hours. Actual enabled controls and standalone review routes/reloads then accepted five new contextual responses in five different sessions, without old lesson/reference/response text. Raw response, revision, session/time and feedback persisted; assistance remained unknown, not certified unaided. This proves scheduling/data ownership only; no real learner waited or demonstrated retention.
- All **10 original full exams / 42 source slots** were traversed through the real UI. All ten unavailable slots showed no answer buttons, retained their denominator and prevented a full-set completion claim. The other thirty-two source comparisons preserved passages, marked lexical targets and original numeric option identities, including distinct N1 duplicate parts. Agreement with those keys is not independent Japanese approval.
- Actual N2 native writing withheld the incomplete model while saving raw text; N4 written production did not display the different spoken question. The actual speaking surface displayed the Japanese question with explicit missing-gloss/hint status; a synthetic teaching request used canonical Japanese rather than the broader written prompt. Native dictation at every level retained raw pre-reveal text and separate self-rating; **no audio was generated and no listening ability was measured**.
- Final disposable progress contained **57 source-advisory answers (52 matches / 5 nonmatches), 21 self-report answers, verified 0**. At 390 px, the held-out N1 native textarea and neutral unassessed feedback had no horizontal overflow. Actual browser diagnostics showed only intentionally blocked external font/Google-sign-in loads, no unexpected JavaScript exceptions.

Scoped AI content/runtime reviews supported these finite changes and their concrete fixes; they do not grant human pedagogical approval. This checkpoint deliberately uses the existing task/lesson/catalog/evidence seams rather than another loader, provider, grading authority or migration. Independent human semantic/editorial review, real selected-model feedback accuracy, actual delayed unaided learner performance, microphone/audio and assistive-technology acceptance remain unmet release/quality gates. **The user reviews before merge.** No PR/main merge, production migration, deploy, installation, real paid inference or real account/provider/voice change is authorized or claimed here.

## 13. Behavior-preserving cleanup and review publication

The user explicitly requested code simplification and **creation of the PR before the next push**. Draft [PR #35](https://github.com/silent9669/VJ_BOT/pull/35) was created from the already published `91aaee8` task branch before this cleanup checkpoint. It is a review surface, not merge or deployment approval.

- `static/learning.js`: build one task-ID-to-source-position map per authored lesson. Reuse it for duplicate/membership checks, prior-task resolution and ordering instead of repeated `find`/`indexOf` scans. Name the required starting stage once so invitation and general-production validation remain readable. No loader, public interface, source content or task-revision contract changes.
- `src/practice-coach.js`: reuse the existing current-account-epoch check for cached feedback. Share one constant attempt-ownership SQL predicate and ordered bind values between feedback write/readback, preventing the two account/epoch/identity/payload/null-safe-session fences from drifting. The successful-write, cache, error and first-writer behavior remains unchanged.
- Exact before/after serialized catalog comparison matched at **all five levels**, including all task IDs, revisions, option positions, keys and evidence. A disposable in-memory comparison of the published and refactored loaders also matched acceptance/error messages for a valid package and nine malformed cases: missing/mixed/forward parents, reversed practice order, duplicate tasks/path, delayed tasks in immediate/reference practice and incomplete delayed cycles. No new permanent validator or alternate implementation was added.
- `node --test --test-concurrency=2 tests/task-contract.test.mjs tests/worker.test.mjs tests/learning-rag-integration.test.mjs` passed **107/107**; `npm run build` then regenerated unchanged catalogs and passed Worker/static dry-run. This was the affected check, not a new full-suite or real-model evaluation.

The existing all-level actual-UI proof in section 12 remains the last UI result: this cleanup changes neither rendered controls nor canonical content. No new provider call, production migration, merge, deployment or human-quality/retention claim is introduced.

### PR CI contract correction before release consideration

The exact-head `b8edd83` GitHub Actions run `43561927275` reported **715/716 Node tests passed**, with one old `tutor-grounding.test.mjs` assertion still requiring `question_jp` inside written-production evidence and the entire written task inside Kaiwa grounding. This contradicts the written/spoken separation implemented in section 12. The assertion was migrated, not the application weakened: written prompt/model/criteria remain checked, spoken grounding must omit the broader written task, and the exact Japanese spoken question remains separately addressable without a fake written-prompt translation.

`node --test tests/tutor-grounding.test.mjs` passed **11/11** after the correction. The failed GitHub run was inspected rather than rerun without a change; the new commit requires its own CI result. No application or source content changed in this test-only correction. Production release remains a separate approval: merging this PR invokes the existing `main` pipeline, including forward migrations `0022`/`0023` and deployment to the live site; the documented preview build is disabled because it would share production D1.

