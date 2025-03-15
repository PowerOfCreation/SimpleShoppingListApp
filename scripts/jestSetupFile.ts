import mockAsyncStorage from "@react-native-async-storage/async-storage/jest/async-storage-mock"

jest.mock("@react-native-async-storage/async-storage", () => mockAsyncStorage)
jest.mock("expo-font") // https://github.com/callstack/react-native-paper/issues/4561#issuecomment-2500877723
