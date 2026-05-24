import type { Config } from "jest"

const config: Config = {
  verbose: true,
  setupFiles: ["<rootDir>/scripts/jestSetupFile.ts"],
  setupFilesAfterEnv: [
    "<rootDir>/scripts/setupFilesAfterEnv.ts",
    "expo-sqlite-mock/src/setup.ts",
  ],
  testTimeout: 10000,
  preset: "jest-expo",
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|react-native-reanimated|react-native-gesture-handler))",
  ],
  coverageReporters: ["json-summary", ["text", { file: "coverage.txt" }]],
  reporters: [
    "default",
    [
      "jest-junit",
      {
        outputDirectory: "coverage",
        outputName: "jest-junit.xml",
        ancestorSeparator: " > ",
        uniqueOutputName: "false",
        suiteNameTemplate: "{filepath}",
        classNameTemplate: "{classname}",
        titleTemplate: "{title}",
      },
    ],
  ],
  coverageDirectory: "<rootDir>/coverage/",
  // https://github.com/microsoft/accessibility-insights-web/pull/5421#issuecomment-1109168149
  moduleNameMapper: {
    "^uuid$": require.resolve("uuid"),
  },
}

export default config
