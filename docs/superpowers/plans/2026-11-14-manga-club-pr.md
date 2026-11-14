# Manga Club PR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finalize the local Manga Club trial and canonical Continue learning fix, then publish a reviewed feature-branch PR without merging.

**Architecture:** Preserve the vanilla Worker/D1 app. Keep the theme loopback-only and resume references account/level-scoped. Add missing role-aware navigation without altering server authorization.

**Tech Stack:** Plain HTML/CSS/JavaScript, Node tests, Cloudflare Vite, GitHub CLI.

**Spec:** `DESIGN.md` and the operator's selected Manga Club direction, supplied `knks.jpg`, per-account resume request, and explicit instruction to finish and create a PR without merge.

## Global Constraints

- No merge, auto-merge, deployment, version bump, release or production migration.
- Keep theme activation limited to localhost, 127.0.0.1 and [::1].
- Never stage .dev.vars, secrets, local databases, Codegraph index, editor server/history, screenshots or logs.
- Preserve the supplied photo's full 4:3 ratio and original colors.
- Retain Vietnamese/Japanese UI and current server-side admin authorization.
- Preserve canonical dataset contents and manifest checksums; normalize only verified CRLF line endings.

## Review Focus

1. Admin grant/revocation and account changes must show/hide admin navigation without stale links.
2. Feature routes and lesson routes must retain the correct active menu, including Kanji.
3. Public or look-alike hosts must never activate the trial even with a saved selection.
4. Long headings, the photo and navigation must not overflow phone or tablet widths.
5. Windows line-ending normalization must not weaken the pinned-data integrity test.

---

### Task 1: Complete role-aware trial navigation

**Files:** Modify `static/local-ui.js`, `tests/local-ui.test.mjs`; preserve `static/manga.css`.

**Interfaces:** Consume the real sidebar admin button's `hidden` state and `data-page` changes; produce existing canonical hash links and correctly hidden admin navigation.

- [ ] Add tests for admin visibility, grant/revoke after mount, and lesson-route selection; include the Kanji route in expected navigation.
- [ ] Run `node --test tests/local-ui.test.mjs` and observe missing-admin/missing-Kanji failures.
- [ ] Add Kanji and a hidden admin link; observe the source admin button for visibility changes without changing permissions.
- [ ] Run `node --test tests/local-ui.test.mjs tests/continue-learning.test.mjs tests/navigation.test.mjs`.

### Task 2: Preserve dataset integrity and update handoff docs

**Files:** Create `.gitattributes`; update `DESIGN.md`, `docs/LOCAL_UI_TRIAL.md`, `README.md`; normalize verified `static/openjlpt/*.json` line endings on disk.

**Interfaces:** Preserve existing manifest SHA-256 byte expectations; document local theme, local admin setup and per-browser resume semantics.

- [ ] Verify raw hashes fail only for CRLF and LF-normalized bytes exactly match every manifest entry.
- [ ] Set `/static/openjlpt/*.json text eol=lf` and normalize only files proven to match after normalization; do not change manifest or test assertions.
- [ ] Run `node --test tests/lessons.test.mjs` with the original strict integrity assertions.
- [ ] Update docs to describe the supplied photo, current admin path, original-vs-Manga switch and per-browser resume limitation; remove stale claims about unchanged app code and historical test counts.

### Task 3: Verify, review and publish PR

**Files:** Stage only `.gitattributes`, `DESIGN.md`, `README.md`, this plan, `docs/LOCAL_UI_TRIAL.md`, `static/index.html`, `static/app.js`, `static/workspace.js`, `static/local-ui.js`, `static/manga.css`, `static/assets/knks.jpg`, `tests/local-ui.test.mjs`, `tests/continue-learning.test.mjs`.

**Interfaces:** Consume completed feature branch; produce commits and one PR to `silent9669/VJ_BOT:main` with limitations and verification evidence.

- [ ] Use a named feature branch; keep current local dev workspace and secrets in place.
- [ ] Run `npm test`, `npm run build` (dry-run), `git diff --check`, and targeted diagnostics.
- [ ] Inspect actual local landing/dashboard/admin navigation, full photo, mobile overflow and reduced-motion behavior when browser integration is available.
- [ ] Perform a separate read-only whole-diff review for bugs, authorization, resume identity, assets and docs. No independent agent is authorized; report self-review accurately.
- [ ] Inspect the staged file list and secret patterns without printing credentials, then commit with no AI co-author line.
- [ ] Push only the feature branch and create a PR against main; never enable auto-merge.
- [ ] Confirm PR URL/state and report CI status without claiming checks passed before completion.
