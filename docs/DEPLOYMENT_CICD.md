# VJBot — Cloudflare Deployment & CI/CD Pipeline

This guide details the deployment pipeline, Cloudflare edge configuration, and GitHub branch protection rules enforced on the **VJBot** repository.

---

## 1. Cloudflare Workers & D1 Production Architecture

- **Production URL**: [`https://vjbot.dangphuc.me/`](https://vjbot.dangphuc.me/)
- **Zone**: `dangphuc.me` (ID: `f566edfee01abd83506943cfb30bad9d`)
- **Worker Script**: `src/worker.js`
- **D1 Database**: `vjbot-db` (ID: `eb0d49a5-7a90-4219-968c-5fcb04390859`) bound as `env.DB`

### Configuration Files
- `wrangler.config.ts`: Defines Worker entry point, assets directory (`.cloudflare/output/v0/workers/default/assets`), compatibility date, and D1 database bindings.
- `cloudflare.config.ts`: Cloudflare CLI configuration file.

---

## 2. Deploying from Local Terminal

### 2.1 Dry-Run Verification
To verify asset compilation and Worker bundling without pushing to production:
```bash
npx cf deploy --dry-run
```

### 2.2 Live Production Deployment
```bash
npx cf deploy
```

---

## 3. GitHub Actions Automated CI/CD Pipeline

The repository uses `.github/workflows/deploy.yml` to automatically test, verify, and deploy every change to production.

```
┌────────────────────────────────────────────────────────┐
│                   Pull Request to main                 │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
         ┌─────────────────────────────────────┐
         │     Job 1: Test & Quality Checks    │
         │                                     │
         │  • Set up Python 3.12               │
         │  • Run Pytest (46 unit & API tests) │
         │  • Set up Node.js 20                │
         │  • Validate Cloudflare Worker Build │
         └──────────────────┬──────────────────┘
                            │ (Must Pass)
                            ▼
┌────────────────────────────────────────────────────────┐
│                    Merge PR into main                  │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
         ┌─────────────────────────────────────┐
         │     Job 2: Deploy to Cloudflare     │
         │                                     │
         │  • Install Node dependencies        │
         │  • Run npx cf deploy                │
         │  • Push Worker & Assets to Edge     │
         └─────────────────────────────────────┘
```

### 3.1 Workflow Secrets Required
Ensure the following repository secrets are set in GitHub (`Settings > Secrets and variables > Actions`):
- `CLOUDFLARE_API_TOKEN`: Cloudflare API Token with Workers & D1 Edit permissions.
- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare Account ID.

---

## 4. Main Branch Protection & Security Policy

The `main` branch is protected by GitHub Ruleset **#25958093** (`Protect main branch`):

1. **Pull Request Required**:
   - Direct pushes to `main` are rejected.
   - All code changes must go through a pull request.
2. **Force Push Blocked (`non_fast_forward`)**:
   - `git push --force` or `git push --force-with-lease` is prohibited.
3. **Deletion Prohibited**:
   - The `main` branch cannot be deleted.
4. **Required Status Checks**:
   - The status check `Test & Quality Checks` must pass before any PR can be merged into `main`.
5. **Bypass Actors**: None (`current_user_can_bypass: never`).

---

## 5. Secret Scanning & Security Rules

- **Zero Hardcoded API Keys**: Never commit raw Google Cloud / Gemini AI Studio API key strings starting with `AQ.Ab...` or `AIza...` directly into tracked git files.
- **Client Key Storage**: API keys are saved locally in the learner's browser `localStorage` or injected via Cloudflare Worker secrets.
