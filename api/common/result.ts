/**
 * Result type for operations that can succeed or fail
 */
export class Result<T, E extends Error = Error> {
  private constructor(
    private readonly value: T | null,
    private readonly error: E | null,
    private readonly isSuccess: boolean
  ) {}

  /**
   * Create a successful result
   */
  static ok<T, E extends Error = Error>(value: T | null): Result<T, E> {
    return new Result<T, E>(value, null, true)
  }

  /**
   * Create a failed result
   */
  static fail<T, E extends Error = Error>(error: E): Result<T, E> {
    return new Result<T, E>(null, error, false)
  }

  /**
   * Check if result is successful
   */
  public get success(): boolean {
    return this.isSuccess
  }

  /**
   * Get the result value, or throw if failed
   */
  public getValue(): T | null {
    if (!this.isSuccess) {
      throw this.error || new Error("Cannot get value from a failed Result")
    }
    return this.value
  }

  /**
   * Get the error, or null if succeeded
   */
  public getError(): E | null {
    return this.error
  }

  /**
   * Map the value of a successful result
   */
  public map<U>(fn: (value: T | null) => U): Result<U, E> {
    if (!this.isSuccess) {
      return Result.fail<U, E>(this.error!)
    }
    try {
      return Result.ok<U, E>(fn(this.value))
    } catch (err) {
      return Result.fail<U, E>(err as E)
    }
  }

  /**
   * Apply a function that may throw to the value of a successful result
   */
  public async asyncMap<U>(
    fn: (value: T | null) => Promise<U>
  ): Promise<Result<U, E>> {
    if (!this.isSuccess) {
      return Result.fail<U, E>(this.error!)
    }
    try {
      const result = await fn(this.value)
      return Result.ok<U, E>(result)
    } catch (err) {
      return Result.fail<U, E>(err as E)
    }
  }

  /**
   * Convert a Promise<T> into a Promise<Result<T, E>>
   */
  static async fromPromise<T, E extends Error = Error>(
    promise: Promise<T>,
    errorMapper: (err: unknown) => E = (err) => err as E
  ): Promise<Result<T, E>> {
    try {
      const value = await promise
      return Result.ok<T, E>(value)
    } catch (err) {
      return Result.fail<T, E>(errorMapper(err))
    }
  }
}
