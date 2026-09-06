// Learn more https://docs.expo.io/guides/customizing-metro
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getDefaultConfig } = require("expo/metro-config")

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname)

// expo-sqlite web support: wa-sqlite ships as a .wasm module, and SharedArrayBuffer
// (used for its OPFS-backed VFS) requires cross-origin isolation.
config.resolver.assetExts.push("wasm")
config.server.enhanceMiddleware = (middleware) => {
  return (req, res, next) => {
    res.setHeader("Cross-Origin-Embedder-Policy", "credentialless")
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin")
    middleware(req, res, next)
  }
}

module.exports = config
