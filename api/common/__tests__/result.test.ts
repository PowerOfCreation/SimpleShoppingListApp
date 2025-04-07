import { Result } from "../result"

describe("Result", () => {
  class TestError extends Error {
    constructor(message: string) {
      super(message)
      this.name = "TestError"
    }
  }

  describe("ok", () => {
    it("should create a successful result with a value", () => {
      const value = { id: 1, name: "Test" }
      const result = Result.ok(value)
      expect(result.success).toBe(true)
      expect(result.getValue()).toBe(value)
      expect(result.getError()).toBeNull()
    })

    it("should create a successful result with null value", () => {
      const result = Result.ok<null, Error>(null)
      expect(result.success).toBe(true)
      expect(result.getValue()).toBeNull()
      expect(result.getError()).toBeNull()
    })
  })

  describe("fail", () => {
    it("should create a failed result with an error", () => {
      const error = new TestError("Something went wrong")
      const result = Result.fail<string, TestError>(error)
      expect(result.success).toBe(false)
      expect(result.getError()).toBe(error)
      expect(() => result.getValue()).toThrow(error)
    })
  })

  describe("getValue", () => {
    it("should return the value for a successful result", () => {
      const value = 42
      const result = Result.ok(value)
      expect(result.getValue()).toBe(value)
    })

    it("should throw the error for a failed result", () => {
      const error = new Error("Failure")
      const result = Result.fail<number>(error)
      expect(() => result.getValue()).toThrow(error)
    })

    it("should throw a generic error if failed result has no specific error", () => {
      // This case shouldn't happen with the current static constructors
      // but testing for completeness based on internal implementation
      const result = new (Result as any)(null, null, false)
      expect(() => result.getValue()).toThrow(
        "Cannot get value from a failed Result"
      )
    })
  })

  describe("getError", () => {
    it("should return null for a successful result", () => {
      const result = Result.ok("Success")
      expect(result.getError()).toBeNull()
    })

    it("should return the error for a failed result", () => {
      const error = new Error("Failure")
      const result = Result.fail<string>(error)
      expect(result.getError()).toBe(error)
    })
  })

  describe("map", () => {
    it("should apply the function to the value of a successful result", () => {
      const result = Result.ok(5)
      const mappedResult = result.map((value) => (value ?? 0) * 2)
      expect(mappedResult.success).toBe(true)
      expect(mappedResult.getValue()).toBe(10)
      expect(mappedResult.getError()).toBeNull()
    })

    it("should return a failed result if the mapping function throws", () => {
      const result = Result.ok(5)
      const error = new Error("Map error")
      const mappedResult = result.map(() => {
        throw error
      })
      expect(mappedResult.success).toBe(false)
      expect(mappedResult.getError()).toBe(error)
      expect(() => mappedResult.getValue()).toThrow(error)
    })

    it("should propagate the error for a failed result", () => {
      const error = new Error("Original error")
      const result = Result.fail<number>(error)
      const mappedResult = result.map((value) => (value ?? 0) * 2)
      expect(mappedResult.success).toBe(false)
      expect(mappedResult.getError()).toBe(error)
      expect(() => mappedResult.getValue()).toThrow(error)
    })
  })

  describe("asyncMap", () => {
    it("should apply the async function to the value of a successful result", async () => {
      const result = Result.ok(5)
      const mappedResult = await result.asyncMap(async (value) =>
        Promise.resolve((value ?? 0) * 2)
      )
      expect(mappedResult.success).toBe(true)
      expect(mappedResult.getValue()).toBe(10)
      expect(mappedResult.getError()).toBeNull()
    })

    it("should return a failed result if the async mapping function throws", async () => {
      const result = Result.ok(5)
      const error = new Error("Async map error")
      const mappedResult = await result.asyncMap(async () => {
        throw error
      })
      expect(mappedResult.success).toBe(false)
      expect(mappedResult.getError()).toBe(error)
      expect(() => mappedResult.getValue()).toThrow(error)
    })

    it("should return a failed result if the async mapping function rejects", async () => {
      const result = Result.ok(5)
      const error = new Error("Async map rejection")
      const mappedResult = await result.asyncMap(async () =>
        Promise.reject(error)
      )
      expect(mappedResult.success).toBe(false)
      expect(mappedResult.getError()).toBe(error)
      expect(() => mappedResult.getValue()).toThrow(error)
    })

    it("should propagate the error for a failed result", async () => {
      const error = new Error("Original error")
      const result = Result.fail<number>(error)
      const mappedResult = await result.asyncMap(async (value) =>
        Promise.resolve((value ?? 0) * 2)
      )
      expect(mappedResult.success).toBe(false)
      expect(mappedResult.getError()).toBe(error)
      expect(() => mappedResult.getValue()).toThrow(error)
    })
  })

  describe("fromPromise", () => {
    it("should create a successful result when the promise resolves", async () => {
      const value = "Resolved value"
      const promise = Promise.resolve(value)
      const result = await Result.fromPromise(promise)
      expect(result.success).toBe(true)
      expect(result.getValue()).toBe(value)
      expect(result.getError()).toBeNull()
    })

    it("should create a failed result when the promise rejects", async () => {
      const error = new Error("Promise rejected")
      const promise = Promise.reject(error)
      const result = await Result.fromPromise<string>(promise)
      expect(result.success).toBe(false)
      expect(result.getError()).toBe(error)
      expect(() => result.getValue()).toThrow(error)
    })

    it("should use the error mapper when the promise rejects", async () => {
      const originalError = "Plain string error"
      const promise = Promise.reject(originalError)
      const errorMapper = (err: unknown) =>
        new TestError(`Mapped: ${String(err)}`)

      const result = await Result.fromPromise<string, TestError>(
        promise,
        errorMapper
      )

      expect(result.success).toBe(false)
      expect(result.getError()).toBeInstanceOf(TestError)
      expect(result.getError()?.message).toBe("Mapped: Plain string error")
      expect(() => result.getValue()).toThrow(result.getError()!)
    })
  })
})
