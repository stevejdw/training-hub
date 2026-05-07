# Deployment

This project is **auto-deployed** via a GitHub Actions workflow (`.github/workflows/deploy.yml`). Every push to `main` triggers a production deployment to Vercel. No manual steps needed.

However, the first time you need to set up a few **GitHub Secrets** for the workflow to work:

## One-time setup: Add GitHub Secrets

Go to **https://github.com/stevejdw/training-hub/settings/secrets/actions** and add these 3 secrets:

| Secret | Value | How to get it |
|--------|-------|---------------|
| `VERCEL_TOKEN` | Your Vercel API token | [https://vercel.com/account/tokens](https://vercel.com/account/tokens) — Create a token with "Full" scope |
| `VERCEL_ORG_ID` | `team_eNq0vXRaOOyK0GIPOgwg3kgR` | From `.vercel/project.json` → `orgId` |
| `VERCEL_PROJECT_ID` | `prj_3eFx1hpxM0WKg0On2tJY1PLkaRe6` | From `.vercel/project.json` → `projectId` |

After that, every `git push origin main` will automatically deploy.

Inspect deployment at: https://vercel.com/stevejdws-projects/training-hub
Project dashboard: https://vercel.com/stevejdws-projects/training-hub

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
