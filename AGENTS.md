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
- **Soft deletes:** `todo_lists`/`todos` have `deleted_at`; queries filter `WHERE deleted_at IS NULL`.
- **sqlc workflow:** edit `sql/queries/*.sql`, run `sqlc generate`, implement in `postgres/`. Never edit `internal/infrastructure/db/sqlc/` manually.
- **Events:** `EventDispatcher` routes by `event_type` string; unknown types are a no-op, not an error (forward compat), but logged at `warn` since it signals client/server version skew.
- **Testing:** real Postgres via testcontainers (`testhelpers.SetupTestDB(t)`), no DB mocking; Docker must be running.
- **Logging:** structured JSON via `log/slog` (`internal/infrastructure/logging`), stdout, level via `LOG_LEVEL`. Logger is passed by constructor DI — every service/controller that logs takes a `*slog.Logger` param; no `log.Printf`/`fmt.Print*`. `slog.SetDefault` is set once in `main` purely to catch stray stdlib `log` output from dependencies, not as a substitute for DI.

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
- **Sync (bidirectional, list content included):** offline mutations (both
  `todo_list.*` and `ingredient.*` events) → `POST /api/v1/events` (REST, 202);
  **WebSocket** (`/api/v1/sync/ws`) pushes per-event **acks**, plus a
  **`{"type":"event"}`** notification to clients subscribed (via
  `{"type":"subscribe","list_ids":[...]}`) to a list that just got a new event —
  so the client doesn't have to poll for either direction. Pull:
  `POST /api/v1/sync/head` reports each list's current server cursor
  (`seq` + latest event id); `GET /api/v1/sync/events` returns a list's event
  history since a given `seq`, applied locally by rebuilding that list's
  projection from its full merged (local + pulled) history. `POST
  /api/v1/sync/state` reconciles lost acks (self-heal for push, keyed by
  `list_id`). Pull only ever fetches lists already known and sync-enabled
  locally — there is **no** "restore my lists after reinstall" / discovery
  endpoint. Replay order is a rebase on the server's `seq` (confirmed prefix,
  server-authoritative) with our own unacked writes as a local tail
  (`byServerSeqThenLocal`), not wall-clock `occurred_at` — see
  `frontend/docs/sync-design-decisions.md`. Whether *this device* syncs a
  list is a device-local setting (`list_sync_settings`, see
  `list-sync-settings-repository.ts`), not a domain event and not a column on
  the `ingredient_lists` projection — that projection rebuilds from the
  event log on every pull/ack, and a rebuildable table is the wrong place for
  a fact a rebuild must never be able to reset.
- **Backend auth:** mandatory. Verifies Keycloak bearer tokens (see
  `backend/internal/interface/api/middleware`) on `/api/v1/events` and every
  `/api/v1/sync/*` route; the API refuses to start if
  `KEYCLOAK_ISSUER`/`KEYCLOAK_CLIENT_ID` aren't set or the issuer is
  unreachable. Still **no user scoping** of the data itself — any valid token
  can read/write any known list id (see design doc).

## Relevant docs

- `frontend/docs/project-overview.md`
- `frontend/docs/sync-design-decisions.md`
- `backend/README.md` (run/sync details)
