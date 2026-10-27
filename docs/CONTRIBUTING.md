# VJBot — Contributor & Teammate Guide

Welcome to the **VJBot** engineering team! This guide will help you set up your local development environment, run tests, adhere to UI/UX and code standards, and ship code safely through our CI/CD pipeline.

---

## 1. Local Development Setup

### 1.1 Prerequisites
- **Python 3.12+**
- **Node.js 20+**
- **Cloudflare CLI (`cf`)** or **Wrangler**
- **Git & GitHub CLI (`gh`)**

### 1.2 Python Environment Setup
```bash
# Create and activate virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt
pip install pytest pytest-asyncio anyio httpx
```

### 1.3 Node.js & Edge Runtime Setup
```bash
# Install npm packages
npm install
```

---

## 2. Running & Verifying Changes

### 2.1 Backend Tests
Always run the pytest suite before submitting any changes:
```bash
PYTHONPATH=. .venv/bin/pytest
```
All 46 unit and API tests must pass.

### 2.2 Cloudflare Worker Build Verification
Verify that your static assets and Worker script bundle properly:
```bash
npx cf deploy --dry-run
```

---

## 3. Git Branching & CI/CD Workflow

The `main` branch is strictly protected:
- **Direct push to `main` is disabled.**
- **Force push is disabled.**
- **Every change must be reviewed and pass CI/CD via a Pull Request.**

### Recommended Step-by-Step Workflow:
```bash
# 1. Ensure you have the latest main
git checkout main
git pull origin main

# 2. Create your feature branch
git checkout -b feat/your-feature-name

# 3. Make changes and verify locally
PYTHONPATH=. .venv/bin/pytest
npx cf deploy --dry-run

# 4. Commit and push your branch
git add .
git commit -m "feat: description of your change"
git push -u origin feat/your-feature-name

# 5. Create a Pull Request
gh pr create --title "feat: your feature" --body "Summary of changes" --base main

# 6. Wait for CI status check (Test & Quality Checks) to pass
gh pr checks <PR_NUMBER> --watch

# 7. Merge into main
gh pr merge <PR_NUMBER> --merge --delete-branch
```
Once merged into `main`, GitHub Actions automatically deploys the latest version to [`https://vjbot.dangphuc.me/`](https://vjbot.dangphuc.me/).

---

## 4. UI/UX & Coding Standards

1. **Apple Liquid Glass Design Language**:
   - Favor translucent cards (`background: rgba(255, 255, 255, 0.75)`, `backdrop-filter: blur(16px)`).
   - Use crisp, subtle borders (`border: 1px solid rgba(0, 0, 0, 0.08)`).
   - Maintain warm paper/ink accents (`--paper-card`, `--ink-dark`).
2. **Typography**:
   - Primary Vietnamese & English font: **Be Vietnam Pro** paired with **Inter**.
   - Japanese typography: **Noto Sans JP**.
   - Code & Furigana monospace: **JetBrains Mono**.
3. **Minimalist Iconography**:
   - Limit emojis to functional badges only. Avoid stacking 3+ emojis in button labels or headers.
   - Favor clean SVG icons, 8-bit brand marks, and typography pills.
4. **D1 SQL Prepared Statements**:
   - Always use `env.DB.prepare(...).bind(...)` to prevent SQL injection vulnerabilities.
5. **No Secret Leaks**:
   - Never commit raw API keys into git. Use environment variables or client-side `localStorage`.
