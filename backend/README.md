# Simple Shopping List App — Backend

Go REST API backend for the offline-first shopping list app (frontend:
`../frontend/`). Receives and durably stores list-sync events from the app.

**Stack:** Echo (HTTP), PostgreSQL (pgx/v5), sqlc, Clean Architecture.

## Run locally (dev)

```bash
docker compose up -d postgres

DATABASE_URL="host=localhost user=postgres password=postgres dbname=todos port=5432 sslmode=disable" go run ./cmd/api
```

The backend + Postgres are only started locally for development. In
production they are deployed differently (managed outside this repo); the
target is configured via the `DATABASE_URL` env var. Keycloak is **not**
started here — it is hosted in K8s and shared by dev and prod. `go run
./cmd/api` directly (without `KEYCLOAK_ISSUER`/`KEYCLOAK_CLIENT_ID` set) runs
with authentication disabled; `docker compose up` points at the same hosted
Keycloak the frontend uses, so a bearer token is required there. Either way,
the backend does not yet **scope** data to a user (any valid token - or, with
auth disabled, any request at all - can read/write any known list id); see
`frontend/docs/sync-design-decisions.md`.

## Sync API

The frontend pushes offline mutations to the backend and pulls a list's full
history back (including from other devices); ack + reconcile round out the
(WIP) sync mechanism. `/api/v1/events`, `/api/v1/sync/*` (including the
WebSocket upgrade) all require a bearer token when Keycloak is configured -
see [Run locally](#run-locally-dev).

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/events` | Accepts a batch of client events (202) for async processing |
| POST | `/api/v1/sync/state` | Reconcile: reports which events the server durably has, per list |
| POST | `/api/v1/sync/head` | Reports each requested list's current pull cursor (seq + latest event id) |
| GET | `/api/v1/sync/events` | Pull: one page of a list's event history since a given seq |
| GET | `/api/v1/sync/ws` | WebSocket; pushes per-event `ack`s to the client (no polling) |

## Updating the dev database schema

`docker-entrypoint-initdb.d` scripts only run against an *empty* data
directory. Postgres keeps its data in the named `postgres_data` volume, so
adding or changing a mounted migration in `docker-compose.yml` has no effect
on an already-initialized dev database - you need to drop the volume first:

```
docker compose down -v
docker compose up -d postgres
```
