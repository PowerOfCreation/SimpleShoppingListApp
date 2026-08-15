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
| POST | `/api/v1/todo-lists/:listId/invites` | Create a multi-use invite link with a TTL preset (`1h`\|`24h`\|`7d`\|`30d`); only the list's owner may call this; returns the plaintext token once |
| GET | `/api/v1/todo-lists/:listId/invites` | List a list's active (non-expired, non-revoked) invites; only the owner may call this; never returns a token |
| DELETE | `/api/v1/invites/:inviteId` | Revoke an invite; only the list's owner may call this |
| POST | `/api/v1/invites/redeem` | Redeem a token, joining the list as `member`; idempotent if already a member |

## List sharing

Lists can be shared via invite links (`ListSharingService`,
`internal/interface/api/rest/list-sharing-controller.go`): the creator picks
a validity preset, gets back a one-time plaintext token, and only its
sha256 hash is ever persisted (`list_invites.token_hash`). A list with no
members yet auto-claims the first inviter as `owner`
(claim-on-first-invite) — the bootstrap for lists that predate this
feature, which otherwise have no owner recorded anywhere.

**This only adds a membership model — it does not enforce it.**
`/api/v1/events` and every `/api/v1/sync/*` route still accept any valid
token for any known list id, same as before; membership isn't checked
there yet. See `frontend/docs/sync-design-decisions.md`.

## Logging

The API logs structured JSON to stdout (via `log/slog`), one line per event
or request:

```json
{"time":"2026-08-02T10:00:00Z","level":"INFO","msg":"request","service":"shopping-list-api","version":"dev","request_id":"3f9c...","method":"GET","uri":"/api/v1/todo-lists","status":200,"latency":1200000}
```

- `LOG_LEVEL` — `debug|info|warn|error` (default `info`). `debug` also adds
  source file/line and per-connection WebSocket detail.
- `LOG_FORMAT` — `json` (default) or `text` for a more readable local format.
- Every request gets a `request_id` (from `X-Request-Id` or generated), set
  on the response header and threaded through the request's logger so
  access-log lines, handler errors, and panics for the same request all
  carry the same id.

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
