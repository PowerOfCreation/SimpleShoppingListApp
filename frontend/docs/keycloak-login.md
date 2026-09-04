# Keycloak Login

Optional OIDC login against Keycloak. The app stays fully usable without it —
all shopping lists live in local SQLite and work without backend or login.
The login sits behind the "Account" drawer entry and gates backend sync: sync
runs only while signed in, and every sync request carries the access token.

## Status

Working and verified end to end on an Android dev build: the browser flow
completes and `[AuthService] Login succeeded` appears in the log, with tokens
stored in Keychain/Keystore. `app/+native-intent.ts` is verified too — without
it expo-router additionally navigates to `/oauth2redirect` and shows its
"Unmatched Route" screen on top of the app after a successful login.

## How it works

Authorization Code flow with PKCE (S256), performed in the system browser
(Chrome Custom Tabs / `ASWebAuthenticationSession`) via `expo-auth-session`.
An embedded WebView is deliberately not used — RFC 8252 requires an external
user agent, and a WebView would neither share the SSO session nor keep the
credentials away from the app.

```
Account screen → AuthProvider.login()
  → auth-service.login()
      fetchDiscoveryAsync(issuer)
      new AuthRequest({ clientId, redirectUri, scopes, usePKCE: true })
      request.promptAsync()          → system browser, user authenticates
      exchangeCodeAsync({ code, code_verifier })
      saveTokens() → expo-secure-store
      fetchUserInfoAsync()           → profile
```

### Files

| Path | Purpose |
| --- | --- |
| `api/auth/config.ts` | Issuer, client id, scopes; `isAuthConfigured()` |
| `api/auth/redirect-uri.ts` | Derives the reverse-DNS redirect URI |
| `api/auth/token-store.ts` | SecureStore wrapper, one key per token |
| `api/auth/auth-service.ts` | `login` / `logout` / `restoreSession` / `getValidAccessToken` |
| `api/auth/AuthProvider.tsx` | React context + `useAuth()` |
| `app/(account)/` | Account screen and its stack layout |
| `app/+native-intent.ts` | Keeps the router off the OIDC redirect URL |
| `components/PrimaryButton.tsx` | Filled action button used by the screen |

`getValidAccessToken()` is the intended entry point for a future API client. It
refreshes the token when needed and returns `null` when signed out.

## Configuration

`.env` (gitignored, template in `.env.example`):

```
EXPO_PUBLIC_KEYCLOAK_ISSUER=https://sso.ops.light-dev-solutions.de/realms/user-apps
EXPO_PUBLIC_KEYCLOAK_CLIENT_ID=shopping-list
```

`EXPO_PUBLIC_*` values are inlined into the bundle and are **not secret**. That
is correct here: the Keycloak client is public and uses PKCE, so there is no
client secret to leak. Without these values the account screen reports that
login is not configured instead of failing.

Jest does not load `.env`; defaults are set in `scripts/jestSetupFile.ts`.

### Keycloak client (`shopping-list`, realm `user-apps`)

- Access type **public**, standard flow on, PKCE method `S256`
- Client scope `offline_access` assigned (otherwise no long-lived refresh token)
- **Valid redirect URIs** and **Valid post logout redirect URIs**:
  `de.lightdevsolutions.sholist*://*`

The `*` must sit **before** the `:` — `de.lightdevsolutions.sholist://*` only
covers the production build and rejects the dev build, whose scheme carries the
`.dev` suffix.

## The redirect URI

RFC 8252 recommends a scheme based on a domain the app controls, so
`app.config.js` declares the reverse-DNS scheme — and only that one:

```js
const BUNDLE_ID = IS_DEV
  ? "de.lightdevsolutions.sholist.dev"
  : "de.lightdevsolutions.sholist"

scheme: BUNDLE_ID
```

iOS derives that scheme from the bundle id on its own; Android only registers it
because it is listed explicitly.

The short `sholist://` scheme that used to sit here was dropped. Declaring two
schemes makes expo-linking guess which one is the app's canonical one: expo-router
calls `Linking.createURL("/")` once at startup without a scheme, and
`resolveScheme()` then takes the first entry and warns about the rest on every
start — in release builds too, that warning is not `__DEV__`-guarded. Nothing
used the short scheme (the dev client's `exp+sholist` comes from `slug`, not from
`scheme`), so removing it is cheaper than living with the warning.

Resulting redirect URI:

```
de.lightdevsolutions.sholist.dev://oauth2redirect   (dev)
de.lightdevsolutions.sholist://oauth2redirect       (production)
```

### Why it is read from `Application.applicationId`

`redirect-uri.ts` deliberately does **not** read `Constants.expoConfig.scheme`.
That value reflects the environment the *bundler* was started in, which can
disagree with the installed binary: running Metro without
`APP_VARIANT=development` against a dev build yields the production scheme, the
app then sends a redirect URI no installed app handles, and the login hangs in
the browser with no error anywhere. `Application.applicationId` comes from the
running binary, and `app.config.js` derives bundle id and scheme from the same
constant, so the two cannot drift. `api/auth/__tests__/redirect-uri.test.ts`
pins this down.

## Running it

```
pnpm run android:dev      # dev variant — note the :dev suffix
```

`pnpm run android` is the **production** variant. Mixing the two is what caused
the redirect mismatch above. `pnpm start` already sets `APP_VARIANT=development`.

After changing `app.config.js`, `android/` and `ios/` must be regenerated —
they are gitignored build output:

```
APP_VARIANT=development pnpm expo prebuild --clean --platform android
```

### Verifying without the UI

```bash
# Scheme registered in the installed APK?
adb shell dumpsys package de.lightdevsolutions.sholist.dev | grep -A2 "Scheme:"

# Does the redirect wake the app?
adb shell am start -a android.intent.action.VIEW \
  -d "de.lightdevsolutions.sholist.dev://oauth2redirect"

# Does Keycloak accept the redirect URI? (200 = yes, 400 = not registered)
curl -s -o /dev/null -w '%{http_code}\n' \
  'https://sso.ops.light-dev-solutions.de/realms/user-apps/protocol/openid-connect/auth?client_id=shopping-list&response_type=code&scope=openid&redirect_uri=de.lightdevsolutions.sholist.dev%3A%2F%2Foauth2redirect&state=s&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256'

# What did the app actually do?
adb logcat -d -v time | grep -E "AuthService|oauth2redirect"
```

The last one is the most useful: `[AuthService] Login succeeded` means the flow
completed regardless of what is on screen.

## Token handling

Each token is stored under its own SecureStore key
(`sholist.auth.accessToken`, `.refreshToken`, `.idToken`, `.meta`). Keycloak's
JWTs are easily larger than the ~2 KB some iOS releases refuse for a single
value, so a combined JSON blob would risk hitting that limit.

Freshness uses `TokenResponse.shouldRefresh()` from `expo-auth-session` rather
than hand-rolled expiry math. When Keycloak does not rotate the refresh token,
the previous one is kept.

Logout clears the local tokens, revokes the refresh token, and opens
`end_session_endpoint` to end the SSO session. The last step matters: without it
the browser cookie signs the user straight back in on the next login attempt.
Revocation and session end are best effort — the app signs out locally either
way.

## Dependencies added

| Package | Why |
| --- | --- |
| `expo-auth-session` | OIDC/PKCE flow (pinned `56.0.15`, see below) |
| `expo-crypto` | Peer dependency for the PKCE challenge |
| `expo-secure-store` | Keychain/Keystore token storage (needs its config plugin entry) |
| `expo-application` | Native application id for the redirect scheme |

`expo-auth-session` is pinned to **56.0.15**, not the newest 56.0.16. The latter
requires `expo-constants ~56.0.22` while the project pins `56.0.21`, which makes
pnpm install a nested second copy of three native modules — `expo-doctor` fails
on that and duplicate native modules can break the build. 56.0.15 matches the
current patch train exactly. When Renovate moves the SDK forward,
`expo-auth-session` can move with it.

## Open issues

1. **Token refresh only happens on demand.** `getValidAccessToken()` refreshes
   when the sync client needs a token; there is no proactive refresh while the
   app sits idle on a screen that doesn't sync.
2. **Keycloak is not in `docker-compose.yml`** — intentional: dev and prod share
   the one hosted instance (`sso.ops.light-dev-solutions.de`), which is never
   started locally (see `../AGENTS.md`).

The backend side (JWT/JWKS middleware, user scoping of events) is built and
enforced on every `/api/v1/events` and `/api/v1/sync/*` route — see
`../../backend/README.md` and `sync-sharing-target.md` §2/§7.1.
