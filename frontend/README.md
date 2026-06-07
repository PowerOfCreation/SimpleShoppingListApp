# Simple Shopping List App

This is an [Expo](https://expo.dev) project (CNG / Continuous Native Generation, React Native, Android focus).

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
| **Scheme** | `sholist-dev://` | `sholist://` | `sholist://` |
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

## Tests

```bash
pnpm test
```

## Useful links

- [Expo CNG (Continuous Native Generation)](https://docs.expo.dev/workflow/continuous-native-generation/)
- [Install app variants on the same device](https://docs.expo.dev/build-reference/variants/)
- [Signed APK for Android](https://reactnative.dev/docs/signed-apk-android)
