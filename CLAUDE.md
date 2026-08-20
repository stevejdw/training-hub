# Deployment

This project is **auto-deployed** via **Vercel Git Integration**. Every push to `main` triggers a production deployment to Vercel. No manual steps needed.

Inspect deployment at: https://vercel.com/stevejdws-projects/training-hub
Project dashboard: https://vercel.com/stevejdws-projects/training-hub

## Deploy workflow — IMPORTANT

**Do NOT push a feature branch to origin before merging it into main.** Vercel deduplicates builds by tree hash: if a branch push creates a preview build, the subsequent fast-forward merge to main has an identical tree hash and Vercel will skip the production rebuild — leaving production stuck on the previous commit.

Correct sequence when shipping changes from a worktree branch:
1. Commit on the branch locally.
2. `git checkout main && git merge <branch> && git push origin main` — push **main first**.
3. Optionally push the branch afterward (or just delete it).

If you accidentally push the branch first and main isn't deploying, create an empty commit on main (`git commit --allow-empty -m "trigger deploy"`) and push to force a fresh production build.

After pushing to main, **verify the new deployment exists** before reporting success — call `mcp__plugin_vercel_vercel__get_deployment` on `training-hub-gamma.vercel.app` and confirm the `githubCommitSha` matches what you just pushed. If it doesn't, trigger an empty-commit redeploy.

---

# Task: Fix CTL/ATL/TSB formula and clean up intervals.icu UI

## Changes Made

- **`lib/fitness.ts`** — Fixed TSB formula to use `ctl - atl` (current values) instead of `prevCtl - prevAtl` (yesterday's values). Fixed timezone bug: `buildFullTimeline` now uses AEST date via `toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' })` instead of UTC `new Date()` for the timeline end. Also fixed `calculateFitnessHistory` cutoff to use AEST.

- **`app/api/analytics/fitness/route.ts`** — Removed `autoSyncWellness()` function (duplicated from readiness route). The readiness route already handles intervals.icu syncing, so the fitness route just reads existing data.

- **`components/training/FitnessTab.tsx`** — Removed intervals.icu sync button, data source indicator ("Connect intervals.icu"), and all related state/effects. The chart now just shows data without any sync infrastructure.

## Design Notes

- SQL still prefers `icu_tss` from `daily_wellness` when available, falling back to Strava TSS. This is forward-compatible if intervals.icu TSS data becomes available.
- Currently `icu_tss` is always null (wellness API doesn't return TSS), so Strava TSS is used.
- readiness route handles intervals.icu auto-sync independently via its own `autoSyncWellness()`.

---

# Repo lives in iCloud Drive

`~/Library/Mobile Documents/com~apple~CloudDocs/...` — iCloud creates conflict
copies (`Card 2.tsx`, `Nav 3.tsx`) while files are being written. 28 of them
were once committed this way.

- **Do not use `git add -A`.** Use `git add -u` plus explicit paths.
- The `* [2-9].*` patterns in `.gitignore` catch them, but check
  `git status --short` before committing regardless.
- iCloud has also caused Turbopack to panic with `Next.js package not found`;
  `rm -rf .next` and restart the dev server when that happens.
