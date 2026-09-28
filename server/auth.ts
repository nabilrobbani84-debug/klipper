import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { AppConfig } from './config.js';
import { AppError } from './errors.js';
import type { AuthenticatedUser } from './types.js';

type SessionPayload = { sub: string; email?: string; role?: 'user' | 'admin'; exp: number };

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

export function createSessionToken(user: AuthenticatedUser, secret: string, ttlSeconds = 86400): string {
  const payload: SessionPayload = { sub: user.id, email: user.email, role: user.role, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const encoded = base64Url(JSON.stringify(payload));
  const signature = base64Url(crypto.createHmac('sha256', secret).update(encoded).digest());
  return `${encoded}.${signature}`;
}

function verifySessionToken(token: string, secret: string): AuthenticatedUser | null {
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;
  const expected = crypto.createHmac('sha256', secret).update(encoded).digest();
  const supplied = Buffer.from(signature, 'base64url');
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString()) as SessionPayload;
    if (!payload.sub || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return { id: payload.sub, email: payload.email, role: payload.role };
  } catch {
    return null;
  }
}

export function requireAuth(config: AppConfig) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const authorization = req.header('authorization');
    const bearer = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    const tokenUser = bearer ? verifySessionToken(bearer, config.AUTH_SECRET) : null;
    if (tokenUser) {
      req.user = tokenUser;
      return next();
    }

    if (config.NODE_ENV !== 'production' && config.ALLOW_DEV_AUTH) {
      const devUserId = req.header('x-dev-user-id') || 'local-development-user';
      req.user = { id: devUserId, role: 'user' };
      return next();
    }

    next(new AppError('UNAUTHENTICATED', 'Sign in is required.', 401));
  };
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}
