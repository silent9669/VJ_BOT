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

The twenty-lesson and tutor-integration phases are **blocked**, not complete:
none of these seven sources has an established app/RAG content-admission basis,
and the editorial pilot has not received human approval. External reference links
do not add new lesson bodies or establish pedagogical improvement. Existing
OpenJLPT/TALPCo/Tatoeba material is a separate possible content path, not an
unannounced substitute for these seven sources.

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
  The importer rejects any attempt to use this reference-only path to set
  `corpus_allowed: true`. A future content-admission path requires explicit review.
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
