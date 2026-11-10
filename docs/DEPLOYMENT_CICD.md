# Cloudflare deployment

Read [HANDOFF.md](HANDOFF.md) first for the current deployed version and remaining verification.

## Targets

- Site: https://vjbot.dangphuc.me/
- Worker: `vjbot`; entrypoint `src/worker.js`.
- D1: `eb0d49a5-7a90-4219-968c-5fcb04390859`, binding `DB`.
- Configuration: `cloudflare.config.ts` and `vite.config.ts`.
- Latest recorded version: `d4933bcf-41fb-401d-a620-c8411ce48666`.

Do not substitute a database/Worker from another project. Verify the current CLI account and configuration before any write. The existing importer targets this production D1 ID directly; it is not a local-only command.

## Secrets and Google

The Worker has secret names `GEMINI_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. Never put values in source, documentation, browser storage, command output or committed environment files. The current ID-token flow uses the client ID and Google's public keys; the client secret is stored but unused.

Google OAuth authorized JavaScript origins must include `https://vjbot.dangphuc.me`. Local sign-in additionally requires `http://localhost:8787`. Rendering the Google button does not establish that the complete login flow works.

## Build and deploy

```sh
npm ci
npm test
npm run build
npm run deploy
```

The dashboard no longer bundles a 3D room. Vite warns about classic script tags in static HTML; these scripts are served as public files in dependency order.

`npm run build` is a Cloudflare dry run; `npm run deploy` changes production. It does not automatically apply migrations or import curriculum. Record the returned version and verify the custom domain after deploying.

## Database migrations and content

```sh
npx cf d1 migrations apply eb0d49a5-7a90-4219-968c-5fcb04390859 --dir migrations
```

Apply through migration 0010 for password accounts and chat request identities. Inspect migration tracking before future schema work; use new migrations rather than modifying already-applied migrations.

To refresh the pinned dataset after reviewing the upstream change:

```sh
npm run data:import
npm test
python3 scripts/upload_lessons.py
npm run deploy
```

The importer creates tracked JSON/attribution/checksums and ignored `data/openjlpt.sql`. The uploader submits restartable 250-statement batches and retains existing learner records. Review its current upsert fields before changing source IDs or structural metadata; it is not a general database reconciliation tool.

For CLI discovery use `npx cf cli search` with a generic action description; avoid putting account IDs, domains or secrets in search queries.

## Production verification

`GET /api/health` should return `status: ok` and the expected curriculum count (10,783 at handoff). Also inspect lesson loading, session behavior, progress read/write, chat history and the browser console. Use isolated QA accounts for mutations and remove only their data afterward. A health check alone does not prove login, saving or AI behavior.

The Worker uses `gcp:us-east4` placement because the default location caused Google TTS rejection. Do not remove it casually; verify audio, not just HTTP status, after placement/model changes.

Before a later deployment, record the current version and choose a compatible rollback version using the CLI's Worker version/deployment commands. A Worker rollback does not undo D1 migrations or learner writes; keep schema changes compatible and plan data recovery separately.

## CI and deploy (one deployer)

- **GitHub Actions** only checks: `ci.yml` runs `npm ci`, `npm test`, `npm run build` on every push to any branch; `python.yml` runs pytest only when `app/`, `scripts/` or Python tests change. No Cloudflare credentials live in GitHub.
- **Cloudflare Workers Builds** is the only deployer. Pushing to `main` builds and deploys; teammates need repo push access and Cloudflare dashboard access to view build logs, not API tokens.
- Dashboard settings (Worker `vjbot` > Settings > Builds): Production branch `main`; Build command `npm test`; Deploy command `npm run release` (applies D1 migrations, then `cf deploy`); Root directory `/`. The Workers Builds API token needs Workers Scripts Edit and D1 Edit.
- Previews are disabled (`cf builds workers update <worker-id> --previews-enabled false`). The default preview command `npx wrangler preview` fails on this `cf` project, and a preview Worker would share the production D1 binding.
- Keep one lockfile (`package-lock.json`). A second one changes which package manager Workers Builds picks.
- Rollback: Worker versions in the dashboard; D1 migrations are not undone.

## AI chat, admin and bring-your-own API

- **Who can use the platform AI:** only an admin. Admin = a Google account whose verified email is in the secret `ADMIN_EMAILS` (comma list). The grant is recorded at Google sign-in and re-checked against the secret on every request, so removing an email revokes admin. Password accounts are never admin (their email is unverified). After adding or changing `ADMIN_EMAILS`, the admin must sign out and sign in with Google once.
- **Everyone else:** Settings > API AI. Choose OpenAI-compatible, Claude (Anthropic) or Gemini, a base URL (https only; blank = the vendor default), a model and an API key. Keys are stored AES-GCM encrypted in D1 (`ai_providers`) with the secret `AI_KEY_SECRET`; changing that secret makes saved keys unreadable and users must re-enter them. Calls go server-side to the user's URL only, never with the platform key.
- **Platform AI:** the secret `GEMINI_API_KEY` (create at https://aistudio.google.com/api-keys) is used only against Google endpoints: the OpenAI-compatible endpoint by default (`gemini-3.8-flash`, fallbacks `gemini-3.6-flash`, `gemini-3.5-flash-lite`, `gemini-2.5-flash`) or Gemini native. Admin panel (sidebar "Quản trị") changes protocol, model and fallbacks and shows activity. An admin who saves their own API in Settings uses that instead.
- **Text-to-speech** still uses `GEMINI_API_KEY` for every signed-in learner (rate limited, 20 AI calls a minute per account).
- **Secrets:** `GEMINI_API_KEY`, `ADMIN_EMAILS`, `AI_KEY_SECRET` (plus the Google ones). Local: copy `.dev.vars.example` to `.dev.vars`.
