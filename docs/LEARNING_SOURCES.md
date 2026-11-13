# Vietnamese learning sources: acquisition and admission

This workstream covers all seven requested sources. It does not equate public access,
free study, a readable page or permissive robots rules with permission to reproduce
lesson bodies in VJBot, RAG indexes, provider prompts or generated adaptations.
The decisions below are conservative project admission decisions, not legal advice.

## Scope and roadmap

The shared native roadmap contains individual `vls-*` tasks; unrelated security,
voice and study workstreams remain independent.

| Phase | Observable acceptance | Admission boundary |
| --- | --- | --- |
| Source assessment | All seven sources have individual access coverage, policy URLs, robots outcomes and an explicit reuse decision | Read bounded public policy/navigation evidence; stop on access restrictions |
| External-reference catalog | `/sources.html` shows all seven sources and their restrictions without replacing existing Irodori/Erin/JLPT materials | Source names, independently written descriptions and ordinary publisher links only |
| N5 editorial pilot | Three complete representative lessons receive real editorial review before expansion | Only rights-cleared material; AI-generated drafts remain separately labeled |
| Twenty N5 lessons | Explanation, five contextual examples, two common errors, five exercises and accepted answer variants for each lesson | No invented human approval or official JLPT certification |
| App acceptance | Open lesson, answer incorrectly, receive a hint, retry and persist progress in the actual UI | Resolve ownership of existing lesson/tutor consumers first; no voice/provider changes |
| Publication | Checked owned checkpoint on the task branch | No main push, merge, deployment or publisher contact |

The twenty-lesson editorial and tutor-learning acceptance phases are **not complete**.
After the initial reference-only checkpoint, the operator explicitly asserted full
crawl/RAG rights for all seven sources and requested short source-first attribution.
The implementation records this as `user_asserted_rights`, not independently verified
publisher permission. Publicly accessible selected lesson passages may enter the
separate attributed corpus under that assertion. NHK access remains blocked, and no
three-lesson or twenty-lesson human editorial approval has been supplied.

## Findings, 2026-11-13

| Source | Observed access | Admission decision | Access-policy finding |
| --- | --- | --- | --- |
| [Naoki](https://www.naoki.edu.vn/thu-vien/nguphap) | Catalog and one bilingual lesson body | Permission required; rights-reserved footer, no app/corpus grant established | Inspected robots allows `/`; not copyright permission |
| [FreeTag](https://freetag.jp/vi/jlpt/grammar/index.html) | Grammar catalog and course/source notes, not individual lessons | Applicable license/rightsholder permission required beyond legally permitted uses; grammar-course grant unresolved | Robots returned HTTP 404; no directive body |
| [Saromalang](https://www.saromalang.com/2011/08/cac-cach-noi-hay-dung-trong-tieng-nhat.html) | One bilingual expression/grammar article | Reuse permission unresolved within inspected article/homepage coverage | Robots disallows `/search` and `/share-widget`; restricted paths not requested |
| [Mokumoku](https://mokumoku.vn/) | Feature shell, about page and sitemap; no verified lesson body | Reuse permission unresolved; authorship/free-access claims are not licenses | Robots excludes account/admin paths; sitemap entries are discovery, not verified lessons |
| [Tieng Nhat Don Gian](https://www.tiengnhatdongian.com/tong-hop-toan-bo-ngu-phap/) | Grammar index only | Explicit permission required before copying; no lesson collection | Robots does not override the visible no-copying notice |
| [NHK Vietnamese](https://www.nhk.or.jp/lesson/vi/) | Previously saved Vietnamese landing page and inspected terms/robots | No automated content ingestion; ordinary outbound references only under the terms | Both inspected NHK hosts exclude named AI agents; further content access stopped |
| [Irodori Vietnamese](https://hn.jpf.go.jp/irodori) | Official editions page and verified Vietnam-office listing | Preserve metadata-only approach; conditional classroom permissions do not establish general app/RAG rights | Main robots returned HTTP 403; Vietnam-host robots not assessed |

Naoki's privacy policy concerns personal/student data, not a content license.
FreeTag's [introduction/reuse policy](https://freetag.jp/vi/intro.html) distinguishes
separately licensed assets and rightsholder approval. Saromalang/Mokumoku findings
are coverage limits, not assertions that no policy exists elsewhere.

NHK [terms](https://www3.nhk.or.jp/nhkworld/en/terms/) were revised October 1, 2026.
Statutory exceptions exist but no applicable project exception was established.
Do not re-fetch NHK lesson pages, PDFs or audio through another backend or identity.
Its existing capture supports only historical access evidence and an outbound link.

Irodori [guidelines](https://www.irodori.jpf.go.jp/privacy.html) and
[FAQ](https://www.irodori.jpf.go.jp/faq.html) permit specified educational uses,
including some fee-charging lessons. Do not mislabel them as universally
noncommercial-only. The Vietnamese site's restriction on selling/redistributing
life-and-culture PowerPoint files is asset-specific. App/RAG reuse and transmission
to selected AI providers remain unapproved for this project.

## Data and refresh boundary

- `static/course/learning-sources.json` is the curated, public reference catalog.
  It contains no copied lesson, exercise, transcript, PDF or audio bodies.
- `scripts/crawl_learning_sources.py` imports ten bounded Agent Reach `web/read`
  captures from an explicitly supplied external directory. It does **not** crawl
  the network, follow discovered links, log in, run an LLM or obtain permissions.
- Manual policy/access assessments are preserved separately from capture metadata.
  The reference importer rejects `corpus_allowed: true`. Actual lesson admission
  under the later operator assertion is handled separately by `build_learning_corpus.py`.
- Capture hashes identify the exact saved Agent Reach JSON, not the publisher's
  original HTTP bytes. Capture times are explicitly local file modification times,
  not asserted publication dates or exact upstream request times. Policy assessment
  dates have day precision.
- All seven sources and their ten nonempty captures must validate before the output
  is atomically replaced. A failed/blocked/missing capture leaves the previous
  catalog intact. Only allowlisted publisher HTTPS links are admitted.
- Page text remains untrusted data. The importer projects metadata; page instructions
  cannot change rights decisions or become browser markup. The UI uses `textContent`
  and origin-checked links, with separate error/retry state from official materials.

Required capture filenames:

| Source | Existing capture files |
| --- | --- |
| Naoki | `naoki.json`, `naoki-wa.json` |
| FreeTag | `freetag.json`, `freetag-sources.json` |
| Saromalang | `saromalang.json` |
| Mokumoku | `mokumoku.json` |
| Tieng Nhat Don Gian | `tiengnhatdongian.json` |
| NHK | `nhk.json` (reuse existing evidence; no new content request) |
| Irodori | `irodori.json`, `irodori-editions.json` |

After a manually authorized assessment/capture refresh, regenerate metadata without
network access:

```sh
python scripts/crawl_learning_sources.py --evidence-dir "<capture-directory>"
```

Raw captures and policy-response bodies remain outside the repository and are not
published with the application. The published catalog retains policy URLs, dated
findings and exact capture hashes/byte counts for traceability. It does not claim
that every linked destination was fetched: sitemap/index-discovered links are
labeled accordingly, and publisher syllabus/qualification claims are not verified.

## Permission and review handoff

Before body acquisition, establish the intended scope with the rightsholder or an
appropriate assessed lawful basis: automated access, stored copies/embeddings,
provider transmission, translations/adaptations, public display and redistribution,
asset-specific conditions, attribution and any commercial use. A grant for one
source, language, asset or purpose must not unlock the others.

Publisher messages require operator approval before sending. Source admission is
separate from Japanese/Vietnamese editorial review. Keep original questions,
canonical answers and accepted variants intact; never treat AI review as human
approval. A model-selected runtime teaching translation must retain original
source identity and cannot supply missing source rights.

## Narrow verification

```sh
python -m pytest --noconftest tests/test_learning_sources.py tests/test_resource_crawlers.py -q
node --test tests/source-catalog.test.mjs
python -m http.server 8796 --bind 127.0.0.1 --directory static
```

Open `/sources.html` on the loopback server. Confirm all seven sources and rights
notices, existing official-material filters, keyboard-operable details/links,
mobile reflow, zero JavaScript errors, and independent failure/retry handling.
These checks establish catalog behavior, not lesson/RAG/real-model quality.

### Last exercised result, 2026-11-13

- The offline importer consumed all ten existing Agent Reach captures for seven
  sources. Published output contains only the curated metadata and capture receipt
  fields; every source remains `corpus_allowed: false`.
- Final focused checks: **19 Python tests passed; 6 Node tests passed** using the
  commands above. Pytest emitted one existing `asyncio_mode` configuration warning
  because the selected interpreter does not load that optional plugin.
- Actual isolated Microsoft Edge opened the source page, rendered all seven
  references, keyboard-opened a source disclosure, displayed the NHK restriction,
  filtered the existing Irodori catalog and recovered through the dedicated retry
  after a synthetic reference-catalog HTTP 503. Official materials remained usable.
- Desktop and 390 CSS-pixel mobile screenshots were inspected; no mobile horizontal
  overflow and no JavaScript page errors were observed. Google Fonts requests were
  intentionally excluded by the loopback-only preview allowlist.
- Static Python review identified arbitrary backend/nested-field publication
  paths. Round 1 fixed only those metadata projections and added regressions.
  Regeneration proved the public data semantically unchanged, preserving the
  applicable browser evidence. The importer does not infer content rights.
- No application-wide suite, deployment, new lesson corpus, paid model invocation,
  real-model teaching evaluation or human editorial approval was performed.

## Operator-authorized attributed RAG extension

The operator reaffirmed: “tôi đc toàn quyền crawl mmấycias đó, nhưng mà nhớ ghi lại
nguồn để dễ truy vấn là dc ghi gọn nguồn chỗ tôi ghi ấy”. This is stored verbatim as
an operator rights assertion with `publisher_permission_independently_verified: false`.
The earlier policy findings remain evidence, not retroactively rewritten approvals.
It does not authorize defeating robots exclusions, authentication, CAPTCHA or rate
limits. NHK receives no further automated requests and contributes no lesson passages.

### Acquisition and provenance

Bounded acquisition selects actual public teaching bodies, not marketing shells or
AI-authored replacements. Naoki, FreeTag, Saromalang, Mokumoku and Tieng Nhat Don Gian
use observed reader/HTML selections. Irodori uses the separately linked official
Vietnam-office route and allowed PDF CDN, not a retry of the blocked main host.
One Vietnamese lesson PDF was observed at 25,295,751 bytes; the initial 8 MB local
budget stopped before download, then a finite 30 MB budget admitted that one file.
Only its original cultural/greeting teaching on PDF pages 17–18 enters the corpus.
No audio, illustrations, full-course mirror or worksheet answer keys are published.

`scripts/build_learning_corpus.py` projects local acquisition manifests into
`static/course/learning-corpus.json`. Every source has a coverage outcome, including
blocked/failed sources with zero documents. Captures are hashed on actual local
bytes. Some captures are selected reader transcriptions, not original HTTP bodies;
their extraction notes explicitly say so. The PDF has a separate binary hash and
is retained outside the repository. Source level labels remain claims, not certified
JLPT classifications. All passages remain pedagogically `unreviewed`.

Stable IDs bind publisher code, source URL, selected content and passage position:
`NK-…-1`, `FT-…-1`, `SR-…-1`, `MK-…-1`, `TN-…-1`, `IR-…-1`.
Each stored passage starts with a `header` containing its short ID, source name
and exact URL. `/sources.html` provides text/ID lookup and puts this attribution
first in each disclosure. It does not present acquired passages as reviewed lessons.

### Retrieval and teaching boundary

`src/learning-rag.js` loads one public asset, validates known publisher HTTPS
origins and passage limits, and performs local lexical retrieval with Vietnamese
accent folding and Japanese token/bigram matching. No embedding service, new API
key, vector database or paid model call is added. At most three 1,400-character
passages enter a generation. The short citation ID itself is also addressable.
This is lexical RAG, not a measured semantic/vector-search quality claim.

`tutor-chat.js`, `study-teacher.js` and `practice-coach.js` attach retrieved passages
as quoted lower-trust evidence to the already selected chat provider. A trusted
policy keeps source instructions, source errors and source level claims from becoming
system rules or grading authority. Canonical exercise answers/options and progress
logic stay unchanged; the independent voice connection is not modified.

Unsubmitted question teaching and hints withhold external passages to avoid adding
answer-bearing context. Submitted practice feedback may retrieve background teaching,
but correctness still comes from the canonical exercise. No-match, unavailable and
withheld states are explicit in provider evidence, rather than claiming a source was
read. Source labels are added deterministically at the start of valid replies, after
provider-schema validation, and persist with chat retries/history. They identify the
supplied evidence, not a guarantee that the model used every passage correctly.

The source-page corpus loader has its own error/retry state and never erases official
Irodori/Erin/JLPT links when corpus loading fails. It renders source text with
`textContent`, not executable markup. Remote URLs are allowlisted, not followed by
the retrieval runtime. Raw capture bodies and the binary PDF stay outside Git.

Regenerate the attributed asset after an authorized finite acquisition:

```sh
python -m scripts.build_learning_corpus --manifest \"<core-manifest.json>\" --manifest \"<additional-manifest.json>\"
```

An actual live model answer and pedagogical reliability require separately observed
inference and editorial review. Synthetic provider-boundary tests establish wiring,
canonical grading preservation, citation persistence and request isolation only.

### Attributed extension: last exercised result

- Actual bounded coverage: **12 documents, 30 passages** after the word-boundary
  repair. Naoki 3, FreeTag 3, Saromalang 1 selected section, Mokumoku 1,
  Tieng Nhat Don Gian 3, Irodori 1 selected PDF section; **NHK 0, blocked**.
  The initial 31-passage build was superseded by lossless contiguous slicing.
  Passage `source_start`/`source_end` offsets reconstruct the selected text exactly.
- Final applicable targeted evidence: **28 Python tests and 62 Node tests passed**.
  The initial provider tests could not import missing worktree dependencies;
  an ignored junction reused already installed `@noble/hashes` 2.4.0 and `jose`
  6.2.14 without installation or lockfile change. Two new synthetic-provider
  fixture failures were corrected to follow the existing native schema-name
  contract; the affected five integration tests then passed. Existing study,
  tutor-session and context-boundary regressions passed without weakening them.
- `npm run build` regenerated canonical catalogs and completed the Worker
  dry-run successfully. No deployment or production migration occurred.
- Actual isolated Edge rendered the final 30-passage corpus, searched the exact
  `MK-985141fee879-1` ID, keyboard-opened its source-first disclosure and retained
  the correct Mokumoku source URL. Desktop/mobile screenshots showed no horizontal
  overflow. Injected corpus HTTP 503 left seven source references and 25 official
  Erin lessons available; retry recovered. No JavaScript page errors occurred.
- Static reviews found and corrected direct regressions in word-boundary splitting,
  body-vs-title ranking, exact citation matching, focused-target queries, overview
  hint/probe withholding and final attributed reply limits. An oversized attributed
  reply fails visibly instead of returning content the existing UI would reject.
- Selected source wording and apparent mistakes remain unedited and `unreviewed`.
  Reader-concatenated FreeTag options, PDF reading-layout artifacts and source-level
  inconsistencies require editorial review; no learner-facing exercise keys were
  created from these passages. Lexical relevance is not semantic correctness.
- Real provider traffic was synthetic at the upstream boundary. No paid inference,
  live-model security/pedagogical acceptance, hardware microphone test, publisher
  contact, NHK access-route resolution, PR, merge or deployment is claimed.

Commands exercised for the attributed extension:

```sh
python -m scripts.build_learning_corpus --manifest \"<core-manifest.json>\" --manifest \"<additional-manifest.json>\"
python -m pytest --noconftest tests/test_learning_sources.py tests/test_learning_corpus.py tests/test_resource_crawlers.py -q
node --test tests/learning-rag.test.mjs tests/learning-rag-integration.test.mjs tests/source-catalog.test.mjs tests/study-teacher.test.mjs tests/tutor-session.test.mjs tests/tutor-context-boundary.test.mjs
npm run build
```

The recorded 62-test result combines unchanged successful targeted files and the
successful repaired integration-file run; it is not a claim that the first combined
command passed. Python retains the existing optional-plugin `asyncio_mode` warning;
Node emits its experimental SQLite warning.

## Six-source continuation

The operator explicitly continued the process for the six accessible sources,
excluding NHK. This batch permits at most four new selected teaching documents per
source; it is not an instruction to mirror every page or manufacture a fixed quota.
Raw captures, rejected candidates and reproducible selection manifests remain under
the external `AIResearch/vls-six-source-expansion-20261113T152200Z/` directory.
Only explicit admitted manifest records enter the public corpus, never all files
matched by a directory glob. Earlier source documents must not be silently repaired
or replaced while adding new material.

### Acquisition and selection decisions

- Irodori: the official Vietnam-office page links the Vietnamese grammar supplement
  `v1Grammar_NM_VN-1.pdf`. The observed response is **3,425,445 bytes, 65 PDF pages**,
  SHA-256 `c5256d4121ba78ede39043d7852346daa5b34431931f7b4828774a7de50b1f41`.
  Four short explanatory sections use exact PDF page references 1, 15, 25 and 50:
  noun predicates, choosing with `Nにします`, `あります・います`, and demonstratives/
  prices. These are **four selected sections from one PDF**, not four PDFs or
  four complete lessons. Furigana-interleaved dialogues and tables are excluded;
  original selected Vietnamese paragraph text is not rewritten.
- Saromalang: retain bounded sections on `Vながら`, past negatives, appearance/
  potential change with `よう`, and concessive `ながらも` examples. Omit long
  conjugation tables, unrelated opinion tangents and exercises. A separate
  `Vていません・Vていない` candidate is excluded after the observed affirmative/
  negative terminology mismatch and malformed `あっていない` table entry.
- Mokumoku: visible public examples only, never reveal-more or hidden hydration.
  The flattened `V-るV-た+ついでに` formula is omitted rather than silently fixed;
  explanation and example spans retain their original text. The source's
  approximate `50%` description of `かもしれない` remains an unreviewed heuristic,
  not a calibrated probability. The malformed `V1 ます+ながら+V2` candidate is excluded.
- Tieng Nhat Don Gian: five of six new candidates contain concrete language issues,
  including Saturday translated as Sunday, incorrect readings, malformed Japanese
  or conflicting rules. Retain only the bounded `てから` structure and examples
  ①–④. The omitted advertising gap is documented as two exact ordered source
  spans. Later examples contain observed reading/translation issues and are not
  admitted. Stopping at one document is intentional, not a claim of source-wide
  quality or failure.

These are AI-assisted source/extraction checks, not human teacher approval or
independent publisher-rights verification. Existing canonical lesson counts,
question options, grading and progress are not changed by adding reference RAG
passages. No paid generation, account/voice change or production deployment is
authorized by this acquisition batch.

### Final coverage for this continuation

| Source | Candidate bodies inspected | New selected documents | Total selected documents |
| --- | --- | --- | --- |
| Naoki | 6 | 4 | 7 |
| FreeTag | 4 | 4 | 7 |
| Saromalang | 5 | 4 | 5 |
| Mokumoku | 5 | 4 | 5 |
| Tieng Nhat Don Gian | 6 | 1 | 4 |
| Irodori | 1 grammar PDF, 65 pages; selected spans on four pages | 4 sections | 5 |
| NHK | Not requested in this continuation | 0 | 0 |

Final corpus: **33 selected documents/sections, 55 passages, 146,887 asset bytes**.
The earlier **12 documents and 30 passage objects remain exactly unchanged**,
including their hashes, source URLs, stable IDs and selected source text. This is
a finite reference corpus, not 33 complete curated lessons or full-site coverage.

Naoki additions cover time/place ranges with `から・まで`, action locations with
`で`, invitations with `ませんか`, and causal `から`. Two candidates with an
interrogative mismatch and `hizuka` romanization typo were excluded. The ambiguous
causal formula is outside the admitted slice. FreeTag additions cover existence,
requests, comparison and desires. Entire quick-check/answer panels and browser-
voice widget text are excluded using exact ordered source-text spans. No generated
replacement explanations or translations were introduced.

### Exercised continuation checks

- Existing importer: **9 Python tests passed**. Existing retrieval, provider-boundary
  integration and source-loader regressions: **23 Node tests passed**. One existing
  optional-plugin `asyncio_mode` warning and Node experimental SQLite warning remain.
- Actual local source consumer verified all 33 document content/capture hashes,
  exact lossless passage offsets, source-first headers and retained original objects.
  All 33 document citation lookups resolved to their corresponding first passage.
- Six natural-language queries returned the intended new source within the bounded
  top three: time ranges, negative requests, past negatives, `ついでに`, `てから`,
  and `あります・います`. Additional returned passages included tangential lexical
  matches; this is not measured semantic relevance or proof of model use.
- Actual isolated Edge loaded all **55 passages**, looked up one new ID from each
  of the six sources, keyboard-opened disclosures and verified exact original URLs,
  including the Irodori PDF page locator. Desktop and 390 CSS-pixel mobile screenshots
  showed source-first text and no horizontal overflow. Existing 25 Erin lessons
  and seven source references remained available; no JavaScript page errors occurred.
- No implementation, canonical lesson catalog, answer, progress, provider or voice
  file changed. No new build was necessary for this data/docs-only continuation;
  the last implementation build remains the earlier successful Worker dry-run.
- Provider responses in integration tests are synthetic. No real model, publisher
  approval, human teacher approval, PR, main merge or production deployment is claimed.

Regeneration used the existing importer, not a new crawler convention:

```sh
python -m scripts.build_learning_corpus --manifest "<external-expansion-directory>/expanded-manifest.json"
python -m pytest --noconftest tests/test_learning_corpus.py -q
node --test tests/learning-rag.test.mjs tests/learning-rag-integration.test.mjs tests/source-catalog.test.mjs
```

The external combined manifest names every exact saved capture and selected text
file, preserves prior records and contains one explicit outcome per accessible
source. Import records only; audit/rejected files must not become RAG passages.

## N5 editorial lesson checkpoints

`static/course/n5-teaching.json` is a separate **AI-authored editorial-staging
asset**, not copied publisher text, a replacement corpus or canonical assessment
truth. Background references retain exact existing source IDs and URLs. New
explanations, contextual examples, common-error contrasts and task rationales are
explicitly generated content. Source rights remain operator-asserted, not an
independently verified publisher grant.

The first checkpoint contains three complete pilots: topic `は`, requests
`てください`, and comparison `より・ほうが`. Each has five contextual Japanese/
Vietnamese examples with readings, two explained common errors, and five tasks
with task-local option identities or provisional accepted variants.

Two independent AI reviews inspected all three lessons, fifteen examples, six
common errors, fifteen tasks and four source references. The Japanese review
corrected neutral self-introduction to `教師` and clarified the distinction between
the comparison baseline and `より`. The repeating-utterance example now uses
`言ってください`; mixed-script answer variants are retained. The evidence review
found no additional staging defect. This is **not qualified human approval**.

Every lesson and task remains non-scored, with no mastery credit. Accepted variants
are provisional task-specific references, not exhaustive judgments of grammatical
possibility. The request pilot's `te-form` prerequisite is intentionally unresolved
until the full twenty-topic content checkpoint; do not mistake this pilot for a
complete independently navigable course.

No canonical application consumer loads this staging asset yet. Active
`feature/teaching-quality` owns the adapters, tutor, practice UI and progress
cutover. Source acquisition must hand over committed content instead of editing
that session's unfinished files or introducing another grading/runtime stack.
Actual wrong-answer, hint, retry and persisted-progress acceptance remains blocked
on that explicit canonical integration handoff. Runtime selected-API teaching and
independent voice settings remain unchanged.
