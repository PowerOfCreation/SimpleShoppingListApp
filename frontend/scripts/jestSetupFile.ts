import { jest } from "@jest/globals"
import mockAsyncStorage from "@react-native-async-storage/async-storage/jest/async-storage-mock"
import mockSafeAreaContext from "react-native-safe-area-context/jest/mock"

// Tests must not depend on a local .env, which jest does not load.
process.env.EXPO_PUBLIC_KEYCLOAK_ISSUER ??= "https://keycloak.test/realms/test"
process.env.EXPO_PUBLIC_KEYCLOAK_CLIENT_ID ??= "test-client"

jest.mock("@react-native-async-storage/async-storage", () => mockAsyncStorage)
jest.mock("expo-font") // https://github.com/callstack/react-native-paper/issues/4561#issuecomment-2500877723
jest.mock("react-native-safe-area-context", () => mockSafeAreaContext)

// expo-secure-store has no JS fallback outside a native runtime.
jest.mock("expo-secure-store", () => {
  const store = new Map<string, string>()
  return {
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value)
    }),
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key)
    }),
  }
})
