import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';
import type { ZodError } from 'zod';
import type { ApiEnvelope } from './types.js';

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

export function validationError(message: string): AppError {
  return new AppError('VALIDATION_ERROR', message, 400);
}

export function formatZodError(error: ZodError): AppError {
  const message = error.issues.map((issue) => `${issue.path.join('.') || 'request'}: ${issue.message}`).join('; ');
  return validationError(message);
}

/** Converts unknown errors into a safe AppError for persisting on jobs. */
export function toAppError(error: unknown, fallbackCode = 'JOB_FAILED', fallbackMessage = 'Processing failed. Please retry the job.'): AppError {
  return error instanceof AppError ? error : new AppError(fallbackCode, fallbackMessage, 500, true);
}

export function errorHandler(): ErrorRequestHandler {
  return (error: unknown, req: Request, res: Response<ApiEnvelope<null>>, _next: NextFunction) => {
    const appError = error instanceof AppError ? error : new AppError('INTERNAL_ERROR', 'The request could not be completed.', 500, false);
    const requestId = String(req.id ?? 'unknown');
    if (appError.statusCode >= 500) req.log?.error({ err: error, requestId, code: appError.code, userId: req.user?.id }, 'request failed');
    else req.log?.warn({ requestId, code: appError.code, userId: req.user?.id }, appError.message);
    if (res.headersSent) {
      res.end();
      return;
    }
    res.status(appError.statusCode).json({
      success: false,
      data: null,
      error: { code: appError.code, message: appError.expose ? appError.message : 'The request could not be completed.' },
      requestId,
    });
  };
}
