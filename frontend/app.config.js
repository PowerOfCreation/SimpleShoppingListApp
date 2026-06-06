const IS_DEV = process.env.APP_VARIANT === 'development';

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
