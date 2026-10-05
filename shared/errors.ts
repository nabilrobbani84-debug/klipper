/** Error with a stable machine code, an HTTP status and a message that is safe to show users. */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 500,
    public readonly expose = statusCode < 500,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function notFound(message = 'Resource not found.'): AppError {
  return new AppError('NOT_FOUND', message, 404);
}

export function toAppError(error: unknown, fallbackCode = 'JOB_FAILED', fallbackMessage = 'Processing failed. Please retry the job.'): AppError {
  return error instanceof AppError ? error : new AppError(fallbackCode, fallbackMessage, 500, true);
}
