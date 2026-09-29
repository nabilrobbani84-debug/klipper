export type ErrorCode =
  | 'INVALID_URL'
  | 'VIDEO_UNAVAILABLE'
  | 'PROCESSING_FAILED'
  | 'TRANSCRIPTION_FAILED'
  | 'AI_FAILED'
  | 'RENDER_FAILED'
  | 'STORAGE_FAILED'
  | 'RATE_LIMITED'
  | 'QUOTA_EXCEEDED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  public code: ErrorCode;
  public statusCode: number;
  public details?: any;

  constructor(code: ErrorCode, message: string, statusCode: number = 400, details?: any) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function formatErrorResponse(err: any) {
  if (err instanceof AppError) {
    return {
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
        timestamp: new Date().toISOString(),
      },
    };
  }

  return {
    error: {
      code: 'INTERNAL_ERROR',
      message: err?.message || 'An unexpected error occurred',
      timestamp: new Date().toISOString(),
    },
  };
}
