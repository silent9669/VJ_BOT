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

Both build/deploy scripts rebuild `static/room.js` from `src/client/room.js`. Do not bypass them with a direct CLI deploy after editing 3D source. Vite warns about classic script tags in static HTML; these scripts are served as public files in dependency order.

`npm run build` is a Cloudflare dry run; `npm run deploy` changes production. It does not automatically apply migrations or import curriculum. Record the returned version and verify the custom domain after deploying.

## Database migrations and content

```sh
npx cf d1 migrations apply eb0d49a5-7a90-4219-968c-5fcb04390859 --dir migrations
```

Migrations 0001–0005 were applied during this work. Inspect migration tracking before future schema work; use new migrations rather than modifying already-applied migrations.

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

## GitHub workflow

`.github/workflows/deploy.yml` runs Python tests, Node Worker/data tests and `npm run build` for pull requests/pushes to main. Its deployment job runs `npm run deploy` only for pushes to main, using the configured Cloudflare token/account ID.

The new workflow changes are local and uncommitted. Hosted CI and branch protection have not been verified for this state. Do not infer them from successful local tests or the direct Cloudflare deployment. Future schema-changing releases need an explicit migration step; the workflow currently does not apply migrations.
