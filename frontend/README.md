# Simple Shopping List App

This is an [Expo](https://expo.dev) project (CNG / Continuous Native Generation, React Native, Android focus).

## Setup

```bash
pnpm install
```

## Android builds

Two separate apps can be installed in parallel on the same device. The app identifier is controlled via the `APP_VARIANT` environment variable in `app.config.js` — the `android/` and `ios/` folders are **not committed** and are generated on demand by `expo prebuild` (CNG pattern).

| | Dev App | Prod App |
|---|---|---|
| **Package** | `de.lightdevsolutions.sholist.dev` | `de.lightdevsolutions.sholist` |
| **App name** | sholist (Dev) | sholist |
| **Scheme** | `sholist-dev://` | `sholist://` |
| **Metro / Fast Refresh** | yes | no |
| **Dev menu** | yes (shake or `adb shell input keyevent 82`) | no |

### Development (connects to Metro)

```bash
pnpm android:dev   # APP_VARIANT=development expo run:android
```

Keep Metro running in a second terminal:

```bash
pnpm start:dev     # APP_VARIANT=development expo start
```

### Production / Release (standalone)

```bash
pnpm android:prod
```

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
