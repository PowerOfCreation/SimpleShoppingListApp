const IS_DEV = process.env.APP_VARIANT === 'development';

// Only build for the target device architecture in dev to avoid freezing the system.
// For release builds, all architectures are included automatically by the release script.
const ANDROID_ARCHS = IS_DEV ? 'arm64-v8a' : 'armeabi-v7a,arm64-v8a,x86,x86_64';

export default {
  name: IS_DEV ? 'sholist (Dev)' : 'sholist',
  slug: 'sholist',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: IS_DEV ? 'sholist-dev' : 'sholist',
  userInterfaceStyle: 'automatic',
  ios: {
    supportsTablet: true,
    bundleIdentifier: IS_DEV
      ? 'de.lightdevsolutions.sholist.dev'
      : 'de.lightdevsolutions.sholist',
  },
  android: {
    adaptiveIcon: {
      foregroundImage: './assets/images/adaptive-icon.png',
      backgroundColor: '#ffffff',
    },
    package: IS_DEV
      ? 'de.lightdevsolutions.sholist.dev'
      : 'de.lightdevsolutions.sholist',
  },
  web: {
    bundler: 'metro',
    output: 'static',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    [
      'expo-build-properties',
      {
        android: {
          gradleProperties: {
            'reactNativeArchitectures': ANDROID_ARCHS,
            'org.gradle.workers.max': '4',
          },
        },
      },
    ],
    'expo-router',
    'expo-font',
    'expo-sqlite',
    'expo-web-browser',
    [
      'expo-splash-screen',
      {
        image: './assets/images/splash.png',
        resizeMode: 'contain',
        backgroundColor: '#ffffff',
      },
    ],
    'expo-status-bar',
  ],
  experiments: {
    typedRoutes: true,
  },
};
