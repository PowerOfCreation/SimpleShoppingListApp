/**
 * Base error class for application errors
 */
export class AppError extends Error {
  constructor(message: string) {
    super(message)
    this.name = this.constructor.name
    Error.captureStackTrace(this, this.constructor)
  }
}

/**
 * Database connection error
 */
export class DbConnectionError extends AppError {
  constructor(
    message: string = "Failed to connect to database",
    public originalError?: unknown
  ) {
    super(message)
  }
}

/**
 * Database query error
 */
export class DbQueryError extends AppError {
  constructor(
    message: string = "Database query failed",
    public operation?: string,
    public entity?: string,
    public originalError?: unknown
  ) {
    super(message)
  }
}

/**
 * Database migration error
 */
export class DbMigrationError extends AppError {
  constructor(
    message: string = "Database migration failed",
    public version?: number,
    public originalError?: unknown
  ) {
    super(message)
  }
}

/**
 * Item not found error
 */
export class NotFoundError extends AppError {
  constructor(
    message: string = "Item not found",
    public entityType?: string,
    public entityId?: string
  ) {
    super(message)
  }
}

/**
 * Validation error
 */
export class ValidationError extends AppError {
  constructor(
    message: string = "Validation failed",
    public field?: string
  ) {
    super(message)
  }
}

/**
 * Authentication error
 */
export class AuthError extends AppError {
  constructor(
    message: string = "Authentication failed",
    public originalError?: unknown
  ) {
    super(message)
  }
}

/**
 * Feature not implemented error
 */
export class NotImplementedError extends AppError {
  constructor(
    message: string = "This feature is not implemented yet",
    public feature?: string
  ) {
    super(message)
  }
}

/**
 * Backend sync error. `retryable` distinguishes "try again later" failures
 * (network hiccup, 5xx, timeout) from ones a retry can't fix (400/401/403 -
 * a resend of the exact same request/outbox row can never succeed, so
 * SyncEngine.flush gives up on it instead of retrying forever; see
 * SyncClient.nonRetryableError).
 */
export class SyncError extends AppError {
  constructor(
    message: string = "Sync failed",
    public retryable: boolean = true,
    public originalError?: unknown
  ) {
    super(message)
  }
}
