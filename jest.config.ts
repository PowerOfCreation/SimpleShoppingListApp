import type { Config } from "jest"

const config: Config = {
  verbose: true,
  setupFilesAfterEnv: ["<rootDir>/scripts/setupFilesAfterEnv.ts"],
  preset: "jest-expo",
}

export default config
