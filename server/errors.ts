import type { ErrorRequestHandler, Request, Response, NextFunction } from 'express';
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

export function errorHandler(): ErrorRequestHandler {
  return (error: unknown, req: Request, res: Response<ApiEnvelope<null>>, _next: NextFunction) => {
    const appError = error instanceof AppError ? error : new AppError('INTERNAL_ERROR', 'The request could not be completed.', 500, false);
    const requestId = String(req.id ?? 'unknown');
    const internalMessage = error instanceof Error ? error.message : String(error);
    req.log?.error({ err: error, requestId, code: appError.code }, 'request failed');
    const message = appError.expose ? appError.message : 'The request could not be completed.';
    res.status(appError.statusCode).json({
      success: false,
      data: null,
      error: { code: appError.code, message },
      requestId,
    });
    void internalMessage;
  };
}
