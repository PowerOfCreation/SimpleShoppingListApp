const {
  withAndroidManifest,
  withAndroidStyles,
} = require("@expo/config-plugins")

const IS_DEV = process.env.APP_VARIANT === "development"

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
const ANDROID_ARCHS = IS_DEV ? "arm64-v8a" : "armeabi-v7a,arm64-v8a,x86,x86_64"

const config = {
  name: IS_DEV ? "sholist (Dev)" : "sholist",
  slug: "sholist",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: IS_DEV ? "sholist-dev" : "sholist",
  userInterfaceStyle: "automatic",
  ios: {
    supportsTablet: true,
    bundleIdentifier: IS_DEV
      ? "de.lightdevsolutions.sholist.dev"
      : "de.lightdevsolutions.sholist",
  },
  android: {
    adaptiveIcon: {
      foregroundImage: "./assets/images/adaptive-icon.png",
      backgroundColor: "#ffffff",
    },
    package: IS_DEV
      ? "de.lightdevsolutions.sholist.dev"
      : "de.lightdevsolutions.sholist",
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
          gradleProperties: {
            reactNativeArchitectures: ANDROID_ARCHS,
            "org.gradle.workers.max": "4",
          },
        },
      },
    ],
    "expo-router",
    "expo-font",
    "expo-sqlite",
    "expo-web-browser",
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
