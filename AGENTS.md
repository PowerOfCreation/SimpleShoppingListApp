# ShoList — Agent Guidance

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

- `expo-doctor` runs in CI (`.github/workflows/frontend-expo-doctor.yml`) **in offline mode** (`EXPO_OFFLINE=1`) inside `frontend/`. Runs on changes to `frontend/package.json` / `frontend/pnpm-lock.yaml`.

## Backend commands (`backend/`)

```bash
docker compose up -d postgres   # start only the DB
go run ./cmd/api
air                            # hot reload (requires air installed)
go test ./...                  # uses testcontainers — Docker must be running
sqlc generate                  # after editing sql/queries/*.sql or migrations/
```

## Backend architecture & patterns (`backend/`)

Clean Architecture: `cmd/api` (wiring) → `internal/domain` (entities/repos/events) → `internal/application` (services, command/query structs) → `internal/infrastructure/db/sqlc` (generated) + `postgres` (sqlc impls) → `internal/interface/api/rest` (handlers).

- **Validated types:** repos only accept validated domain types — invalid state unrepresentable at compile time.
- **sqlc workflow:** edit `sql/queries/*.sql`, run `sqlc generate`, implement in `postgres/`. Never edit `internal/infrastructure/db/sqlc/` manually.
- **Events:** the server is content-blind — it stores and relays `events` rows without ever parsing `payload` (structure only: envelope shape, JSON validity, size caps in `event-controller.go`). An unknown `event_type` is simply appended like any other; that *is* the forward compat (R1/R2 in `frontend/docs/sync-sharing-target.md` §6).
- **Testing:** real Postgres via testcontainers (`testhelpers.SetupTestDB(t)`), no DB mocking; Docker must be running.
- **Logging:** structured JSON via `log/slog` (`internal/infrastructure/logging`), stdout, level via `LOG_LEVEL`. Logger is passed by constructor DI — every service/controller that logs takes a `*slog.Logger` param; no `log.Printf`/`fmt.Print*`. `slog.SetDefault` is set once in `main` purely to catch stray stdlib `log` output from dependencies, not as a substitute for DI.

## Architecture notes

- **Offline-first:** SQLite is the source of truth; the app works without backend or login.
- **Keycloak:** optional OIDC/PKCE login; the same hosted Keycloak (`sso.ops.light-dev-solutions.de`) is shared for dev and prod, runs in K8s, and is **never started locally**. Setup/debugging: `frontend/docs/keycloak-login.md`.
- **Dev app id != prod app id:** `de.lightdevsolutions.sholist.dev` (dev) vs `de.lightdevsolutions.sholist` (prod), controlled via `APP_VARIANT` in `app.config.js`.
- **Env/config:** backend URL via `.env.development` / `.env.production` (`EXPO_PUBLIC_API_URL`, checked in); Keycloak via local `.env`. Backend target via `DATABASE_URL`.
- **Sync & sharing:** bidirectional event sync (push, pull, reconcile, WebSocket pull-trigger) and invite-link sharing. Backend auth is mandatory and every `/api/v1/events` + `/api/v1/sync/*` call requires membership of every list involved. This area has many non-obvious invariants (push response is the *only* confirmation — no WS ack; device-local sync setting never lives in a projection; replay order is `byServerSeqThenLocal`, never wall-clock). **`frontend/docs/sync-sharing-target.md` is the authoritative spec — bei Widerspruch maßgeblich.** PRs in this area must be checkable against its §2 and §6. Decision log: `frontend/docs/sync-design-decisions.md`.
- **Helm chart delivery:** `charts/imp-list/` is one chart for the whole app (per-component values keys and templates, own release pipeline as OCI artifact). Details and known limitations: `charts/imp-list/README.md`.

## Relevant docs

- `frontend/docs/sync-sharing-target.md` — Sollzustand Sync & Teilen (Spezifikation, maßgeblich): Rollen, Lebenszyklus, Invarianten §6 inkl. R1–R4, offene Entscheidungen §7
- `frontend/docs/sync-design-decisions.md` — Entscheidungsprotokoll (rückblickend: „warum ist X so")
- `frontend/docs/project-overview.md` — Frontend-Architektur & Patterns (Layering, Result, BaseRepository)
- `frontend/docs/keycloak-login.md` — OIDC/PKCE-Login: Setup, Konfiguration, Debugging
- `backend/README.md` — Run, Sync-API, List sharing, Releasing
- `charts/imp-list/README.md` — Helm-Chart: Values, Ingress, Credentials, Limitierungen
