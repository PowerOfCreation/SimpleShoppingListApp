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
