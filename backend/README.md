# Simple Shopping List App — Backend

Go REST API backend for the offline-first shopping list app (frontend:
`../frontend/`). Receives and durably stores list-sync events from the app.

**Stack:** Echo (HTTP), PostgreSQL (pgx/v5), sqlc, Clean Architecture.

## Run locally (dev)

Auth is **mandatory** — the API refuses to start without a reachable
Keycloak. `KEYCLOAK_ISSUER`/`KEYCLOAK_CLIENT_ID` point at the same hosted
Keycloak the frontend uses (`sso.ops.light-dev-solutions.de`); it's never run
locally, so this needs network access to it.

1. Start Postgres:
   ```bash
   docker compose up -d postgres
   ```
2. Start the API — pick one:
   - **`air`** (hot reload): reads `DATABASE_URL`/`KEYCLOAK_ISSUER`/`KEYCLOAK_CLIENT_ID`
     from the checked-in `.env` automatically.
     ```bash
     air
     ```
   - **`go run`** directly — same vars from `.env`, exported manually:
     ```bash
     export $(grep -v '^#' .env | xargs)
     go run ./cmd/api
     ```
   - **`docker compose up api`**: same config, baked into `docker-compose.yml`.
     ```bash
     docker compose up -d
     ```

Postgres and the API are only run locally for development; in production
they're deployed elsewhere, targeting `DATABASE_URL`.

The backend does not yet **scope** data to a user — any valid token can
read/write any known list id; see `frontend/docs/sync-design-decisions.md`.

## Sync API

Sync is bidirectional: the frontend pushes offline mutations *and* pulls a
list's full history back (including changes from other devices); ack +
reconcile + a live WebSocket nudge mean neither direction has to poll.
`/api/v1/events` and every `/api/v1/sync/*` route (including the WebSocket
upgrade) require a bearer token — see [Run locally](#run-locally-dev).

Not yet built: user-scoping (any valid token can read/write any known list
id) and a "restore my lists after reinstall" endpoint — pull only ever
fetches lists already known and sync-enabled locally. See
`frontend/docs/sync-design-decisions.md`.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/events` | Accepts a batch of client events (202) for async processing |
| POST | `/api/v1/sync/state` | Reconcile: reports which events the server durably has, per list |
| POST | `/api/v1/sync/head` | Reports each requested list's current pull cursor (seq + latest event id) |
| GET | `/api/v1/sync/events` | Pull: one page of a list's event history since a given seq |
| GET | `/api/v1/sync/ws` | WebSocket; pushes per-event `ack`s and, to clients subscribed to a list (`{"type":"subscribe","list_ids":[...]}`), a `{"type":"event"}` notification when that list gets a new event |

## Updating the dev database schema

Migrations are embedded into the binary (`migrations/migrations.go`) and
applied automatically by the API on every startup (see `Migrate` in
`internal/infrastructure/db/postgres/migrate.go`): each `NNNNN-*.up.sql`
file runs once, tracked in a `schema_migrations` table, idempotently and
inside a transaction. Add a new `NNNNN-description.up.sql` file and it is
picked up on the next start — no manual step needed.

Existing dev databases were created before this runner existed and have no
`schema_migrations` table, so their first run would try to re-apply
everything. Bring a dev DB up to date once by reseeding it from scratch:

```
docker compose down -v
docker compose up -d postgres
air
```

Postgres keeps its data in the named `postgres_data` volume; `-v` deletes it
so the next start starts empty and the runner applies the full schema.
