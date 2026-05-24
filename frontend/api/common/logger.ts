/**
 * Logger levels
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

/**
 * Current minimum log level
 * Set to DEBUG in development, INFO in production
 */
const CURRENT_LOG_LEVEL = __DEV__ ? LogLevel.DEBUG : LogLevel.INFO

/**
 * Logger for application
 */
export class Logger {
  constructor(private context: string) {}

  /**
   * Log debug message
   */
  debug(message: string, ...meta: unknown[]): void {
    this.log(LogLevel.DEBUG, message, meta)
  }

  /**
   * Log info message
   */
  info(message: string, ...meta: unknown[]): void {
    this.log(LogLevel.INFO, message, meta)
  }

  /**
   * Log warning message
   */
  warn(message: string, ...meta: unknown[]): void {
    this.log(LogLevel.WARN, message, meta)
  }

  /**
   * Log error message
   */
  error(message: string, error?: unknown, ...meta: unknown[]): void {
    const metaWithError = error ? [error, ...meta] : meta
    this.log(LogLevel.ERROR, message, metaWithError)
  }

  /**
   * Log message with level
   */
  private log(level: LogLevel, message: string, meta: unknown[] = []): void {
    if (level < CURRENT_LOG_LEVEL) return

    const timestamp = new Date().toISOString()
    const prefix = `[${timestamp}] [${LogLevel[level]}] [${this.context}]`

    switch (level) {
      case LogLevel.DEBUG:
        console.debug(`${prefix} ${message}`, ...meta)
        break
      case LogLevel.INFO:
        console.info(`${prefix} ${message}`, ...meta)
        break
      case LogLevel.WARN:
        console.warn(`${prefix} ${message}`, ...meta)
        break
      case LogLevel.ERROR:
        console.error(`${prefix} ${message}`, ...meta)
        break
    }
  }
}

/**
 * Create a logger for a context
 */
export function createLogger(context: string): Logger {
  return new Logger(context)
}
