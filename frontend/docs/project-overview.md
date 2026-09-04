# ShoList Project Overview

ShoList is an offline-first shopping list app built with React Native and Expo
(Android focus). Users create lists, add ingredients, mark them complete, edit,
reorder and share them. All data lives in a local SQLite database
(`expo-sqlite`); backend sync and Keycloak login are strictly optional add-ons —
the app is fully functional without either.

## Technology Stack

- **React Native + Expo** (Expo Router, CNG — the `android/`/`ios/` folders are generated, not committed)
- **TypeScript**, simple React hooks for state (no external state library)
- **SQLite** (`expo-sqlite`) as the single source of truth
- **Jest** + React Native Testing Library

## Architecture

The app is layered; each layer only talks to the one below it:

```
Screens (app/)  →  hooks  →  services (api/)  →  repositories (database/)
```

- **Optimistic updates:** the UI updates immediately and rolls back on failure.
- **`Result<T, E>` everywhere** (`api/common/result.ts`): operations that can fail return a Result instead of throwing. Check `result.success` before `getValue()`/`getError()`; prefer `map`/`asyncMap` over manual unwrapping.
- **`BaseRepository`** (`database/base-repository.ts`): abstract base for all repositories — standardized error handling, transaction support, logging via `_executeQuery`/`_executeTransaction`. Extend it for any new repository; keep SQL inside the repository layer.

### Offline-first data layer

The local data layer is **event-sourced**: mutations append rows to
`domain_events` (`database/event-repository.ts`), and per-aggregate projections
(`database/ingredient-list-projection.ts`, `database/ingredient-projection.ts`)
are derived from that log. Projections are rebuilt from the full merged history
rather than patched incrementally — forward application and full replay must
produce identical state.

Two tables deliberately live *outside* the event log:

- `sync_cursors` — pull position per list (projections are `DELETE`d and rebuilt on every pull, so a cursor there would reset itself).
- `list_sync_settings` — whether *this device* syncs a given list. A device-local decision, never an event, never a projection column.

### Sync and login (optional)

- **Sync** pushes local events from an outbox (`database/outbox-repository.ts` →
  `api/sync/sync-engine.ts`) and pulls remote history (`api/sync/`), coordinated
  by `api/sync/sync-coordinator.ts` and gated on login via
  `api/sync/SyncProvider.tsx`. The push response is the only confirmation; a
  WebSocket (`api/sync/sync-socket.ts`) is a debounced pull trigger for other
  devices' writes.
- **Keycloak login** (OIDC/PKCE) lives in `api/auth/`; see
  [keycloak-login.md](keycloak-login.md).
- Sync semantics, sharing, and the invariants both sides must hold: see
  [sync-sharing-target.md](sync-sharing-target.md) (authoritative spec) and
  [sync-design-decisions.md](sync-design-decisions.md) (decision log).

## Project Structure

```
app/                  Expo Router screens: (home) lists/items/sharing,
                      (account) login, (events) local event-log viewer
api/                  Services
  ingredient-service  Ingredient CRUD orchestration
  shopping-list-service
  sync/               Outbox push, pull, reconcile, WebSocket, coordinator
  auth/               OIDC/PKCE login (AuthService, AuthProvider, token store)
  sharing/            Invite create/list/revoke client + deep-link building
  common/             Result type, logger, error types, client-id
database/             SQLite layer
  database.ts         Connection + versioning
  migrations.ts       Schema migrations (migrations/)
  data-migration.ts   One-time AsyncStorage → SQLite migration
  event-repository.ts domain_events (local event log)
  *-projection.ts     Projections derived from the event log
  *-repository.ts     Outbox, sync cursors, list sync settings, …
  base-repository.ts  Abstract repository base (see above)
components/           Themed + feature components (ContextMenu, Entry, …)
hooks/                useIngredients, theme hooks
types/                DomainEvent, Ingredient, IngredientList, Priority, …
utils/                Sorting, priority, invite formatting
constants/            Colors, UUIDs
```

## Development

```bash
pnpm install
pnpm test     # Jest
pnpm lint     # eslint + tsc --noEmit
pnpm start    # Expo dev server (APP_VARIANT=development)
```

Build variants (dev/prod package ids, standalone APK, backend/sync setup):
see the [frontend README](../README.md) and the [backend README](../../backend/README.md).
