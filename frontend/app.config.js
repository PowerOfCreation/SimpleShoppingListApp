const {
  withAndroidManifest,
  withAndroidStyles,
} = require("@expo/config-plugins")

const IS_DEV = process.env.APP_VARIANT === "development"

const BUNDLE_ID = IS_DEV
  ? "de.lightdevsolutions.sholist.dev"
  : "de.lightdevsolutions.sholist"

// Android's "Force Dark" auto-repaints views it thinks are light-themed,
// which shifts our custom dark-mode colors (e.g. adds a blue cast to the
// background) even though the hex values in Colors.ts are correct.
function withForceDarkDisabled(config) {
  return withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application[0]
    application.$["android:forceDarkAllowed"] = "false"
    return config
  })
}

// The app manages light/dark colors itself via useColorScheme() + Colors.ts.
// A DayNight native theme makes Android *also* auto-switch/recolor views
// based on system theme, which is what actually causes near-black colors to
// get reprocessed and shifted (see facebook/react-native#31052). Locking the
// theme to Light prevents Android from touching our colors at all.
function withAppThemeAlwaysLight(config) {
  return withAndroidStyles(config, (config) => {
    const appTheme = config.modResults.resources.style?.find(
      (style) => style.$.name === "AppTheme"
    )
    if (appTheme) {
      appTheme.$.parent = "Theme.AppCompat.Light.NoActionBar"
    }
    return config
  })
}

// Only build for the target device architecture in dev to avoid freezing the system.
// For release builds, all architectures are included automatically by the release script.
// CI_ANDROID_ARCH lets the E2E workflow build only the emulator's ABI (x86_64) instead
// of all four — the other three are never exercised by that emulator, just wasted CMake
// time. Unset in every other context, so real release builds are unaffected.
const ANDROID_ARCHS = IS_DEV
  ? ["arm64-v8a"]
  : (process.env.CI_ANDROID_ARCH?.split(",") ?? [
      "armeabi-v7a",
      "arm64-v8a",
      "x86",
      "x86_64",
    ])

const config = {
  name: IS_DEV ? "sholist (Dev)" : "sholist",
  slug: "sholist",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  // The reverse-DNS scheme is what the OIDC login redirects back to (RFC 8252).
  // iOS derives it from the bundle id automatically, Android only lists it when
  // it is declared here explicitly. Exactly one entry on purpose: with several,
  // expo-linking has to guess the app's canonical scheme and warns on every
  // start.
  scheme: BUNDLE_ID,
  userInterfaceStyle: "automatic",
  ios: {
    supportsTablet: true,
    bundleIdentifier: BUNDLE_ID,
  },
  android: {
    adaptiveIcon: {
      foregroundImage: "./assets/images/adaptive-icon.png",
      backgroundColor: "#ffffff",
    },
    package: BUNDLE_ID,
    // Verified App Link: assetlinks.json for both BUNDLE_ID variants is
    // hosted at static.ops.light-dev-solutions.de (see docs/.well-known/
    // at the repo root, served via GitHub Pages). autoVerify lets Android
    // open the app directly instead of showing a browser/app chooser.
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [
          {
            scheme: "https",
            host: "static.ops.light-dev-solutions.de",
            pathPrefix: "/invite",
          },
        ],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  web: {
    bundler: "metro",
    output: "static",
    favicon: "./assets/images/favicon.png",
  },
  plugins: [
    [
      "expo-build-properties",
      {
        android: {
          buildArchs: ANDROID_ARCHS,
          // Android release builds block cleartext (http://, ws://) traffic
          // by default - only debug builds get a permissive network
          // security config automatically. Without this, a release APK
          // pointed at a plain-http backend (e.g. a local dev server over
          // adb reverse) fails every sync request silently.
          usesCleartextTraffic: true,
        },
      },
    ],
    "expo-router",
    "expo-font",
    "expo-sqlite",
    "expo-web-browser",
    "expo-secure-store",
    [
      "expo-splash-screen",
      {
        image: "./assets/images/splash.png",
        resizeMode: "contain",
        backgroundColor: "#ffffff",
      },
    ],
    "expo-status-bar",
  ],
  experiments: {
    typedRoutes: true,
  },
}

export default withAppThemeAlwaysLight(withForceDarkDisabled(config))
