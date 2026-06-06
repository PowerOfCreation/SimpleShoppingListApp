const expo = require("eslint-config-expo/flat")
const reactNative = require("@react-native/eslint-plugin")
const { fixupPluginRules } = require("@eslint/compat")
// eslint-plugin-react-native is maintenance-only (maintainer hasn't worked with RN
// for years), but no actively maintained replacement exists for these style rules.
// fixupPluginRules wraps the legacy plugin API for ESLint v9 flat config compatibility.
const reactNativeLegacy = require("eslint-plugin-react-native")
const jest = require("eslint-plugin-jest")
const prettierRecommended = require("eslint-plugin-prettier/recommended")

module.exports = [
  { ignores: ["expo-env.d.ts", "metro.config.js"] },
  ...expo,
  {
    plugins: { "@react-native": reactNative },
    rules: {
      "@react-native/platform-colors": "warn",
      "@react-native/no-deep-imports": "warn",
    },
  },
  {
    plugins: { "react-native": fixupPluginRules(reactNativeLegacy) },
    rules: {
      "react-native/no-inline-styles": "warn",
      "react-native/no-unused-styles": "warn",
      "react-native/split-platform-components": "warn",
      "react-native/no-color-literals": "warn",
    },
  },
  {
    files: ["**/__tests__/**/*.{ts,tsx}", "**/*.test.{ts,tsx}"],
    ...jest.configs["flat/recommended"],
  },
  {
    rules: {
      "import/named": "error",
      // React Compiler lint rule (react-hooks v7) — incompatible with the async
      // data-fetching pattern used here (setState before first await in useCallback).
      // Re-enable if the project adopts the React Compiler.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  prettierRecommended,
]
