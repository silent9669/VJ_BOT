# Continuing development

Read [the handoff](HANDOFF.md) and inspect `git status` before editing. Development has resumed; preserve the existing uncommitted tree. Do not switch/reset branches or merge/deploy merely to tidy it.

## Local setup

Use Node 22.13+ for the Worker tests' SQLite adapter. The production UI is vanilla HTML/CSS/JavaScript; Python is a separate backend implementation.

```sh
npm ci
npm run dev
```

The local Worker runs at `http://localhost:8787`. Production secret bindings do not mean local credentials are automatically present. Keep local secret values in ignored environment configuration; check the CLI's current configuration guidance. Apply migrations to the intended local database before testing database-backed flows locally.

For the separate Python suite, create a virtual environment, install `requirements.txt` and its test dependencies (`pytest`, `pytest-asyncio`, `httpx`), then run `npm run test:python`.

## Product and code conventions

- Preserve the notebook/sketch direction and the existing stack. No unrequested React migration.
- Use one male pixel teacher, Lâm, wearing a vest. Edit the original generator/asset consistently.
- Keep text concise. Avoid taglines, redundant helper labels, emoji-heavy navigation and decorative dashboards.
- Retain keyboard access, native dialog behavior, readable mobile layouts and reduced motion.
- Keep Three.js animation time-based; stop idle/hidden rendering and clean up GPU resources.
- Ground new lessons in reviewed source material. Preserve attribution, language labels and licensing; do not invent coverage claims.
- Keep credentials server-side. Authenticate ownership in the Worker instead of trusting client IDs.
- Keep changes scoped. Reproduce a suspected bug before changing adjacent code.
- Do not add AI co-author attribution to commits.

## Verification

```sh
npm test
npm run build
npm run test:python
git diff --check
```

Run checks appropriate to the edited implementation. The Python tests do not prove Worker behavior. Use Chrome DevTools to review the actual pages, keyboard interaction, mobile layout, console, animation and fallback paths. For persistence changes, test reloads and separate account sessions against isolated QA data.

Do not claim Google login is verified solely because the button renders or a synthetic session works. Do not claim TTS is working from a 200 fallback response. Distinguish local tests, hosted CI and production evidence in the handoff or PR.

## Source generation and Git

Edit `src/client/room.js`, then rebuild through `npm run build:room` (also included in build/deploy). Dataset imports and the teacher generator have separate scripts; do not run them for unrelated UI changes.

When work resumes, review the dirty files before staging. Split data, auth/backend, UI and documentation into coherent changes where practical. Commit messages should explain behavior. Verify branch protections and CI state rather than assuming old documentation reflects remote configuration.
