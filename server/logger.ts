export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogContext {
  requestId?: string;
  userId?: string;
  projectId?: string;
  jobId?: string;
  stage?: string;
  durationMs?: number;
  [key: string]: any;
}

export class Logger {
  private static sanitize(obj: any): any {
    if (!obj || typeof obj !== 'object') return obj;
    const sanitized: any = Array.isArray(obj) ? [] : {};
    for (const [key, value] of Object.entries(obj)) {
      if (/key|secret|password|token|auth|cookie/i.test(key)) {
        sanitized[key] = '***REDACTED***';
      } else if (typeof value === 'object') {
        sanitized[key] = Logger.sanitize(value);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  public static info(message: string, context: LogContext = {}) {
    Logger.log('info', message, context);
  }

  public static warn(message: string, context: LogContext = {}) {
    Logger.log('warn', message, context);
  }

  public static error(message: string, context: LogContext = {}) {
    Logger.log('error', message, context);
  }

  public static debug(message: string, context: LogContext = {}) {
    if (process.env.DEBUG) {
      Logger.log('debug', message, context);
    }
  }

  private static log(level: LogLevel, message: string, context: LogContext) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...Logger.sanitize(context),
    };
    if (level === 'error') {
      console.error(JSON.stringify(entry));
    } else if (level === 'warn') {
      console.warn(JSON.stringify(entry));
    } else {
      console.log(JSON.stringify(entry));
    }
  }
}
