# CLAUDE.md

Guidance for working with this monorepo (frontend + backend of the offline-first shopping list app).

## Project Overview

- **Frontend** (`frontend/`): React Native / Expo (CNG), offline-first shopping list. All data lives in local SQLite (`expo-sqlite`); sync and Keycloak login are strictly optional add-ons.
- **Backend** (`backend/`): Go REST API (Echo, PostgreSQL, sqlc, Clean Architecture) that stores list-sync events from the app.

## Package manager

- Use **pnpm** everywhere (`pnpm install`, `pnpm run ...`). Node setup installs via pnpm.

## Frontend commands (`frontend/`)

```bash
pnpm install
pnpm test
pnpm lint          # eslint + tsc --noEmit
pnpm start         # Expo dev (APP_VARIANT=development)
pnpm android:dev   # dev build, package de.lightdevsolutions.sholist.dev
pnpm android:prod  # release build
pnpm android:prod:apk
```

### expo-doctor

- `expo-doctor` runs in CI (`.github/workflows/expo-doctor.yml`) **in offline mode** (`EXPO_OFFLINE=1`) inside `frontend/`. Runs on changes to `frontend/package.json` / `frontend/pnpm-lock.yaml`.

## Architecture notes

- **Offline-first:** SQLite is the source of truth; the app works without backend or login.
- **Keycloak:** optional OIDC/PKCE login; the same hosted Keycloak
  (`sso.ops.light-dev-solutions.de`) is shared for dev and prod, runs in K8s,
  and is **never started locally**.
- **Dev app id != prod app id:** `de.lightdevsolutions.sholist.dev` (dev) vs
  `de.lightdevsolutions.sholist` (prod), controlled via `APP_VARIANT` in `app.config.js`.
- **Env/config:** backend URL via `.env.development` / `.env.production`
  (`EXPO_PUBLIC_API_URL`, checked in); Keycloak via local `.env`. Backend
  target via `DATABASE_URL`.
- **Sync (WIP, client→server only):** offline mutations → `POST /api/v1/events`
  (REST, 202); **WebSocket** (`/api/v1/sync/ws`) pushes per-event **acks** so the
  client doesn't poll. `/api/v1/sync/state` reconciles lost acks. There is **no
  webhook** and **no server→client pull sync yet**. See
  `frontend/docs/sync-design-decisions.md`.
- **Backend auth:** no JWT validation / user scoping yet — deferred (see design doc).

## Relevant docs

- `frontend/docs/project-overview.md`
- `frontend/docs/sync-design-decisions.md`
- `backend/CLAUDE.md` (Go/Clean Architecture details)
