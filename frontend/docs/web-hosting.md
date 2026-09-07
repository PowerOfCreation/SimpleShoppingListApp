# Hosting the ShoList web release

Extract the archive into a static web server's document root and serve over HTTPS
(or localhost for testing). Serve `.wasm` files as `application/wasm` and resolve
extensionless routes to their exported `.html` files.

Set these HTTP response headers on the site, matching the Metro development server:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

These are required for `SharedArrayBuffer`, used by expo-sqlite's web storage.
The headers in `metro.config.js` apply only to Metro and do not configure a
production static host. See [Expo SQLite web setup](https://docs.expo.dev/versions/latest/sdk/sqlite/#web-setup).

The production API URL and optional Keycloak configuration are baked into the
JavaScript bundle at build time. Configure backend CORS and Keycloak redirect URIs
for your web origin if enabling login/sync. Database data remains in this
browser's local storage; deploying the files does not create a server database.
