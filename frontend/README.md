# Simple Shopping List App

This is an [Expo](https://expo.dev) project (bare workflow, React Native, Android focus).

## Setup

```bash
pnpm install
```

## Android builds

Two separate apps can be installed in parallel on the same device:

| | Dev App | Prod App |
|---|---|---|
| **Package** | `de.lightdevsolutions.sholist.dev` | `de.lightdevsolutions.sholist` |
| **App name** | sholist Dev | sholist |
| **Metro / Fast Refresh** | yes | no |
| **Dev menu** | yes (shake or `adb shell input keyevent 82`) | no |

### Development (connects to Metro)

```bash
pnpm android:dev
```

Keep Metro running in a second terminal:

```bash
pnpm expo start
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

## Tests

```bash
pnpm test
```

## Useful links

- [Signed APK for Android](https://reactnative.dev/docs/signed-apk-android)
- [Expo bare workflow](https://docs.expo.dev/workflow/overview/)
