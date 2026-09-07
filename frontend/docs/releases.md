# Frontend releases

The **Frontend Release** GitHub Actions workflow builds signed Android APK/AAB
files and a static web archive on GitHub-hosted runners. No EAS account is needed.
iOS and store submission are not part of this workflow.

## One-time setup

Enable **Settings → General → Releases → Enable release immutability** in GitHub.
The workflow uploads and verifies every asset on a draft before publishing it,
then checks GitHub's `immutable` flag. Published releases are never overwritten.
See [GitHub's immutable release documentation](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases).

Configure these repository Actions secrets:

| Secret | Value |
|---|---|
| `ANDROID_RELEASE_KEYSTORE_BASE64` | Base64-encoded existing signing keystore |
| `ANDROID_RELEASE_STORE_PASSWORD` | Keystore password |
| `ANDROID_RELEASE_KEY_ALIAS` | Signing key alias |
| `ANDROID_RELEASE_KEY_PASSWORD` | Key password |

Keep an independent backup of the keystore and passwords. CI never generates a
replacement key and fails if any signing secret is missing.

For optional login/sync, configure repository Actions variables
`EXPO_PUBLIC_KEYCLOAK_ISSUER` and `EXPO_PUBLIC_KEYCLOAK_CLIENT_ID` as described in
[keycloak-login.md](keycloak-login.md). These public values are embedded in the
artifacts. The API URL comes from the checked-in `.env.production`.

### Keep updates compatible with locally installed APKs

Android updates require the same application ID and signing certificate, plus a
version code at least as high as the installed build. RC and stable builds both
use `de.lightdevsolutions.sholist`; they update each other. The `.dev` app remains
separate. See [Android's update rules](https://developer.android.com/google/play/app-updates).

The generated local Gradle project currently uses `android/app/debug.keystore`
for **release** signing, alias `androiddebugkey`, with `android` as both passwords.
If this was the configuration used for your installed APK, preserve that exact
keystore before running another clean prebuild. Do not generate a new keystore
and expect it to update the existing installation.

Compare the SHA-256 certificate fingerprint of the old APK with the keystore:

```bash
apksigner verify --print-certs previous.apk
keytool -list -v -keystore android/app/debug.keystore -alias androiddebugkey
```

If you only have the installed app, use `adb shell pm path de.lightdevsolutions.sholist`
and `adb pull <returned-base.apk-path> previous.apk` to obtain its APK first.
The tools are supplied by the Android SDK build-tools and JDK respectively.

After confirming the key, upload it without printing it to the terminal
(run from `frontend/`, with GitHub CLI authenticated):

```bash
base64 -w 0 android/app/debug.keystore | gh secret set ANDROID_RELEASE_KEYSTORE_BASE64
printf '%s' android | gh secret set ANDROID_RELEASE_STORE_PASSWORD
printf '%s' androiddebugkey | gh secret set ANDROID_RELEASE_KEY_ALIAS
printf '%s' android | gh secret set ANDROID_RELEASE_KEY_PASSWORD
```

These example passwords apply only to the existing debug keystore. A debug key is
not suitable for public production distribution or Play submission; the AAB is
not store-ready while using it. Choose a private production key before that
stage and plan the transition from existing debug-signed installations. Changing
keys normally requires reinstalling, which deletes this offline-first app's local
data. Do not uninstall merely to resolve a signature mismatch without preserving
your data first. A signing change also requires updating the App Links certificate
fingerprints in `docs/.well-known/assetlinks.json` at the repository root.

## Create candidates and stable releases

Run **Actions → Frontend Release → Run workflow** on the intended branch:

- `channel: rc` (default): creates `frontend-vX.Y.Z-rc.N`, a GitHub prerelease.
  The next candidate number is computed from existing tags for that base version.
- `channel: stable`: creates `frontend-vX.Y.Z`, a regular GitHub release.
- `version`: optional base version such as `1.2.0`. Leave empty to let git-cliff
  compute the conventional-commit bump since the last stable frontend tag;
  the first automatic release starts at `1.0.0`.

You can also push an explicit `frontend-v1.2.0-rc.1` or `frontend-v1.2.0` tag.
Other tag formats fail validation. An automatically selected version that already
exists is rejected; specify a new version if there are no bump-worthy commits.

To graduate a tested candidate, push the stable tag on that candidate's commit:

```bash
git tag frontend-v1.2.0 frontend-v1.2.0-rc.2^{}
git push origin frontend-v1.2.0
```

This creates a **new build** from the tested source, with a new Android build
number; it does not rename the candidate or promise byte-identical promotion.
The original candidate remains intact. For another test iteration, create another
RC. Frontend releases use `--latest=false` so they do not take over the monorepo's
global “Latest” release from backend/chart releases.

The native display version is the base `X.Y.Z` (without `-rc.N`), while the GitHub
tag identifies the channel. Android `versionCode` is the workflow's monotonically
increasing `github.run_number`; reruns keep the original number. Keep this workflow
and its run numbering when moving toward Play distribution. If existing local
builds have a higher version code, adjust the build-number scheme before release.

## Artifacts and failure handling

Every release contains:

- `sholist-android.apk`: signed standalone APK, installable without Metro.
- `sholist-android.aab`: signed Android App Bundle, reserved for future store use.
- `sholist-web.tar.gz`: static Expo export plus `HOSTING.md` with required headers.
- `SHA256SUMS`: checksums of all three artifacts.

Lint, tests, web export, native compilation, and APK signature verification must
pass before a release draft is created. Publication downloads the uploaded assets
and verifies their checksums before making the release immutable. All builds use
the frozen pnpm lockfile and production configuration.

A failure before publication leaves no published partial release. A failed draft
can be retried with **Re-run failed jobs** on the original workflow run; only a
draft targeting the exact source commit can be reused. Published releases are
rejected even if GitHub immutability has accidentally been disabled. If the final
immutability check fails, the release has already been published: enable the
repository setting and use a new version for a protected release (the setting is
not retroactive).

Changelogs use `frontend/cliff.toml`, the same git-cliff grouping as backend/chart.
Both candidates and stable releases cover changes since the previous stable
frontend tag, including frontend files and shared Node/release workflow changes.
Backend/chart-only commits do not appear.
