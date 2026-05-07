# Deployment

This project is deployed on Vercel. The Vercel CLI is available via npx.

**After every commit/push**, deploy the latest code to production:
```
npx vercel --prod --yes
```

> **Note:** Vercel GitHub integration is NOT configured for auto-deploy. The `.vercel/project.json` exists from a manual `vercel link`, but there is no GitHub Actions workflow or Vercel Git integration to trigger deploys automatically on push. You must run the deploy command manually after pushing changes.

Inspect deployment at: https://vercel.com/stevejdws-projects/training-hub/2GcBxiGbF5D8pgVKDpdy2bLsxyKm
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
