module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint"],
  extends: [
    "expo",
    "eslint:recommended",
    "@react-native-community",
    "plugin:@typescript-eslint/recommended",
    "prettier",
  ],
  rules: {
    "import/named": "error",
  },
}
