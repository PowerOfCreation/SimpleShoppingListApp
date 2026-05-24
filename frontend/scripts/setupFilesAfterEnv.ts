import "@testing-library/jest-native/extend-expect"

// Mock the logger to avoid console output during tests
jest.mock("@/api/common/logger", () => ({
  createLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}))
