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

The backend **scopes** data to a user: every `/api/v1/events` and
`/api/v1/sync/*` call requires the caller to be a member (owner or member)
of every list involved, enforced synchronously by `ListAccessService`. See
[List sharing](#list-sharing).

## Sync API

Sync is bidirectional: the frontend pushes offline mutations *and* pulls a
list's full history back (including changes from other devices). A push is
confirmed by its own response, and a live WebSocket nudge tells a device
when *another* device wrote, so neither direction has to poll.
`/api/v1/events` and every `/api/v1/sync/*` route (including the WebSocket
upgrade) require a bearer token — see [Run locally](#run-locally-dev).

Not yet built: a "restore my lists after reinstall" endpoint — pull only
ever fetches lists already known and sync-enabled locally, and discovering
a user's other lists needs its own, separate endpoint. See
`frontend/docs/sync-sharing-target.md` §8.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/events` | Appends a batch of client events durably, then answers 200 with `acked: [{event_id, seq}]` — the response *is* the commit confirmation |
| POST | `/api/v1/sync/state` | Reconcile: reports which events the server durably has, per list |
| POST | `/api/v1/sync/head` | Reports each requested list's current pull cursor (seq + latest event id) |
| GET | `/api/v1/sync/events` | Pull: one page of a list's event history since a given seq |
| GET | `/api/v1/sync/ws` | WebSocket; to clients subscribed to a list (`{"type":"subscribe","list_ids":[...]}`), a `{"type":"event"}` notification when that list gets a new event. Nothing about the caller's own push travels here |
| POST | `/api/v1/todo-lists/:listId/invites` | Create a multi-use invite link with a TTL preset (`1h`\|`24h`\|`7d`\|`30d`); owner-only (see [List sharing](#list-sharing)); returns the plaintext token once |
| GET | `/api/v1/todo-lists/:listId/invites` | List a list's active (non-expired, non-revoked) invites; only the owner may call this; never returns a token |
| DELETE | `/api/v1/invites/:inviteId` | Revoke an invite; only the list's owner may call this |
| POST | `/api/v1/invites/redeem` | Redeem a token, joining the list as `member`; idempotent if already a member |

## List sharing

Lists can be shared via invite links (`ListSharingService`,
`internal/interface/api/rest/list-sharing-controller.go`): the creator picks
a validity preset, gets back a one-time plaintext token, and only its
sha256 hash is ever persisted (`list_invites.token_hash`). Ownership is
granted the first time anyone pushes an event for a list
(`ListAccessService.AuthorizeWrite`, called from `POST /api/v1/events`), not
by inviting — `CreateInvite` and every other sharing action require the
caller to already be the owner.

**Membership is enforced everywhere, not just on the sharing endpoints.**
`/api/v1/events` and every `/api/v1/sync/*` route (including the WebSocket
upgrade) require the caller to be a member (owner or member) of every
list_id involved — checked synchronously by `ListAccessService`, on every
request, before anything is written or read.

For the target architecture — roles, list lifecycle, invariants every
sync/sharing PR should be checked against — see
`frontend/docs/sync-sharing-target.md`.

## Logging

The API logs structured JSON to stdout (via `log/slog`), one line per event
or request:

```json
{"time":"2026-08-02T10:00:00Z","level":"INFO","msg":"request","service":"shopping-list-api","version":"dev","request_id":"3f9c...","method":"GET","uri":"/api/v1/sync/head","status":200,"latency":1200000}
```

- `LOG_LEVEL` — `debug|info|warn|error` (default `info`). `debug` also adds
  source file/line and per-connection WebSocket detail.
- `LOG_FORMAT` — `json` (default) or `text` for a more readable local format.
- Every request gets a `request_id` (from `X-Request-Id` or generated), set
  on the response header and threaded through the request's logger so
  access-log lines, handler errors, and panics for the same request all
  carry the same id.

## Releasing

`.github/workflows/backend-release.yml` builds a hardened image
(`gcr.io/distroless/static-debian12:nonroot`, non-root, no shell) and
publishes it to Docker Hub. Two ways to trigger it:

- **Push a tag** matching `backend-v<major>.<minor>.<patch>` (e.g.
  `backend-v1.4.0`).
- **Run the workflow manually** (Actions → Backend Release → Run workflow) —
  the next version is computed automatically from Conventional Commits on
  `backend/**` since the last `backend-v*` tag (via
  [git-cliff](https://git-cliff.org), config in `backend/cliff.toml`), and
  that tag is created and pushed for you.

Either path builds & pushes by digest, boots the image against a throwaway
Postgres and the real hosted Keycloak issuer (smoke test), only *then*
promotes the `X.Y.Z`/`X.Y`/`X`/`sha-<commit>` tags to that exact manifest,
signs it (cosign, keyless/GitHub OIDC), and scans it (Trivy → GitHub code
scanning). No `latest` tag is published — pin a version or a digest.

Verify a release:

```bash
cosign verify <image>@<digest> \
  --certificate-identity-regexp '^https://github.com/PowerOfCreation/SimpleShoppingListApp/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com

docker buildx imagetools inspect <image>@<digest> --format '{{json .SBOM}}'
docker buildx imagetools inspect <image>@<digest> --format '{{json .Provenance}}'
```

Requires repo secrets `DOCKERHUB_USERNAME`/`DOCKERHUB_TOKEN` (Docker Hub
push access) to be configured.

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
