# Simple Shopping List App

This is an [Expo](https://expo.dev) project (CNG / Continuous Native Generation, React Native, Android focus).

## Architecture

A fully offline-first shopping list app. All data lives in a local SQLite
database (`expo-sqlite`); list sync with the Go backend (`../backend`) is a
**strictly optional** add-on, so the app works identically even without a
backend or login. Keycloak login is optional too — without it the account
screen just reports that login is not configured.

- **Frontend:** React Native + Expo (Expo Router, expo-sqlite as source of truth)
- **Backend:** Go REST API (Echo, PostgreSQL, sqlc) — see `../backend/README.md`
- **Auth:** optional Keycloak (OIDC, PKCE, public client). The same hosted
  Keycloak (`sso.ops.light-dev-solutions.de`) is used for dev and prod; it runs
  in the K8s cluster and is **never started locally**.
- **Sync:** bidirectional. Offline mutations (list *and* item changes) are
  pushed via `POST /api/v1/events` (REST), whose response confirms what
  landed; a WebSocket (`/api/v1/sync/ws`) delivers, for lists the client
  subscribes to, live "new event" notifications from other devices, so pull
  doesn't have to poll either. Restoring lists after a reinstall isn't
  implemented - pull only fetches lists already known and sync-enabled
  locally.
- **Deployment:** backend + Postgres run locally during development and are
  configured elsewhere in prod; env (`EXPO_PUBLIC_API_URL`, `DATABASE_URL`,
  `.env.development`/`.env.production`) picks the target.

## Setup

```bash
pnpm install
```

## Android builds

Two separate apps can be installed in parallel on the same device. The app identifier is controlled via the `APP_VARIANT` environment variable in `app.config.js` — the `android/` and `ios/` folders are **not committed** and are generated on demand by `expo prebuild` (CNG pattern).

| | Dev App | Prod (USB) | Prod (Standalone APK) |
|---|---|---|---|
| **Package** | `de.lightdevsolutions.sholist.dev` | `de.lightdevsolutions.sholist` | `de.lightdevsolutions.sholist` |
| **App name** | sholist (Dev) | sholist | sholist |
| **Scheme** | `de.lightdevsolutions.sholist.dev://` | `de.lightdevsolutions.sholist://` | `de.lightdevsolutions.sholist://` |
| **Metro / Fast Refresh** | yes | yes (lädt JS von Metro) | no – JS in APK eingebettet |
| **Dev menu** | yes (shake or `adb shell input keyevent 82`) | no | no |
| **Läuft ohne USB** | no | **no** | **yes** |
| **Befehl** | `android:dev` | `android:prod` | `android:prod:apk` |

### Development (connects to Metro)

```bash
pnpm android:dev   # APP_VARIANT=development expo run:android
```

Keep Metro running in a second terminal:

```bash
pnpm start
```

### Production / Release – mit USB (JS von Metro)

```bash
pnpm android:prod
```

> Startet Metro und lädt den JS-Bundle zur Laufzeit vom PC. Nützlich für schnelle Release-Variant-Tests, aber die App funktioniert **nicht** nach dem Trennen der USB-Verbindung.

### Production / Release – Standalone APK (kein USB nötig)

```bash
pnpm android:prod:apk
```

Baut eine echte Standalone-APK: `expo prebuild` regeneriert `android/` aus `app.config.js`, danach bettet Gradle den JS-Bundle fest in die APK ein. Die App läuft nach der Installation vollständig ohne USB, Metro oder PC-Verbindung.

> **Hinweis:** `expo prebuild --clean` ist nur nötig, wenn sich `app.config.js` geändert hat. Für schnelle Iterationen ohne Config-Änderungen reicht:
> ```bash
> cd android && ./gradlew assembleRelease && adb install -r app/build/outputs/apk/release/app-release.apk
> ```

### Reinstall from scratch

```bash
adb uninstall de.lightdevsolutions.sholist.dev   # Dev App
adb uninstall de.lightdevsolutions.sholist        # Prod App
```

### Regenerate native folders

The `android/` folder is a build artifact. If it is missing or needs to be refreshed:

```bash
# Dev variant
APP_VARIANT=development npx expo prebuild --clean

# Prod variant
npx expo prebuild --clean
```

`expo run:android` / `pnpm android:dev` runs prebuild automatically, so this is only needed when opening the project in Android Studio directly.

## Backend / sync

The app talks to the Go backend (`../backend`) for list sync, using
`EXPO_PUBLIC_API_URL`. This is deliberately **not** something you set in a
local `.env`: dev and production values are checked in as
`.env.development` / `.env.production`, and Expo picks between them based on
the build (dev builds and `pnpm start` get `.env.development`; `android:prod`
and `android:prod:apk` get `.env.production`). Sync is optional — without a
configured URL, or without being signed in, the app works the same as before
and just never syncs.

Sync works in both directions. Offline mutations (list *and* item events) go
to `POST /api/v1/events`, which appends them durably before answering 200
with the `seq` each one was assigned - that response is the confirmation, so
push needs neither polling nor a second channel. A response lost in transit
costs nothing: the row stays pending and the next flush re-pushes it, which
the backend answers idempotently. `/api/v1/sync/state` covers the opposite
direction - events we believe are synced that the server has no record of.
For pull, `POST /api/v1/sync/head` +
`GET /api/v1/sync/events` fetch whatever a sync-enabled list is missing
locally, and the same WebSocket connection - after sending
`{"type":"subscribe","list_ids":[...]}` - gets a live `{"type":"event"}`
notification whenever one of those lists changes on another device, instead
of waiting for the next periodic pull. Not implemented: restoring/discovering
lists after a reinstall (pull only ever fetches lists already known and
sync-enabled locally) and user-scoping on the backend (see
`docs/sync-design-decisions.md`).

### Sharing a list (invite links)

A list this device syncs can be shared from its context menu ("Invite
people"), which opens `app/(home)/share_shopping_list.tsx`: it lists the
list's active invite links, creates a new one with a server-side validity
preset (1h / 24h / 7d / 30d) and revokes existing ones, all through
`api/sharing/sharing-client.ts`. Only the owner may do any of this — that is
enforced by the backend and shown here as an error message, because the
client has no endpoint yet to ask what its own role is.

The link itself is built on the device (`api/sharing/invite-link.ts`) as
`<app scheme>://invite?token=…` — the backend never learns a frontend route,
so it only ever hands out the raw token, exactly once, in the response that
created the invite. It cannot be fetched again afterwards; only its hash is
stored. **Redeeming is not implemented yet**: nothing in the app handles that
deep link, so an invited person cannot join through it so far. The same goes
for showing who has already joined — that needs a backend endpoint that does
not exist yet (see `docs/sync-sharing-target.md` §5).

`.env.development` points at `http://10.0.2.2:8080`, the Android emulator's
alias for the host machine's localhost, so `pnpm android:dev` talks to a
backend running locally via `docker compose up -d postgres && go run
./cmd/api` (see `../backend/README.md`). On a **physical device** over USB,
`10.0.2.2` doesn't resolve — either run `adb reverse tcp:8080 tcp:8080` so the
device forwards that port to your machine, or point `EXPO_PUBLIC_API_URL` at
a LAN-reachable host instead.

## Tests

```bash
pnpm test
```


## Maestro smoke test (Android)

A minimal CI smoke test runs on GitHub-hosted Android emulator runners and builds
the test APK locally with `expo prebuild` + Gradle.

No Expo token or Expo cloud build is required for this CI smoke test.

Run the smoke flow locally (with a booted Android emulator and app already installed):

```bash
maestro test .maestro/smoke.yml
```

## Useful links

- [Expo CNG (Continuous Native Generation)](https://docs.expo.dev/workflow/continuous-native-generation/)
- [Install app variants on the same device](https://docs.expo.dev/build-reference/variants/)
- [Signed APK for Android](https://reactnative.dev/docs/signed-apk-android)
