import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { AppConfig } from './config.js';
import { AppError } from './errors.js';
import type { AuthenticatedUser } from './types.js';

type SessionPayload = { sub: string; email?: string; role?: 'user' | 'admin'; exp: number; jti: string };

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createSessionToken(user: AuthenticatedUser, secret: string, ttlSeconds = 86400): { token: string; jti: string; expiresAt: Date } {
  const jti = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  const payload: SessionPayload = { sub: user.id, email: user.email, role: user.role, exp: Math.floor(expiresAt.getTime() / 1000), jti };
  const encoded = base64Url(JSON.stringify(payload));
  const signature = base64Url(crypto.createHmac('sha256', secret).update(encoded).digest());
  return { token: `${encoded}.${signature}`, jti, expiresAt };
}

function verifySessionToken(token: string, secret: string): (AuthenticatedUser & { jti: string }) | null {
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;
  const expected = crypto.createHmac('sha256', secret).update(encoded).digest();
  const supplied = Buffer.from(signature, 'base64url');
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString()) as SessionPayload;
    if (!payload.sub || !payload.jti || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return { id: payload.sub, email: payload.email, role: payload.role, jti: payload.jti };
  } catch {
    return null;
  }
}

export function getBearerToken(req: Request): string | null {
  const authorization = req.header('authorization');
  return authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;
}

export function requireAuth(config: AppConfig, isRevoked?: (tokenHash: string) => Promise<boolean>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const bearer = getBearerToken(req);
    const tokenUser = bearer ? verifySessionToken(bearer, config.AUTH_SECRET) : null;
    if (tokenUser) {
      const continueRequest = async () => {
        if (isRevoked && await isRevoked(hashSessionToken(bearer))) throw new AppError('SESSION_REVOKED', 'Your session has expired. Please sign in again.', 401);
        req.user = { id: tokenUser.id, email: tokenUser.email, role: tokenUser.role };
        req.sessionToken = bearer;
        next();
      };
      void continueRequest().catch(next);
      return;
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
      sessionToken?: string;
    }
  }
}


export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await new Promise<Buffer>((resolve, reject) => crypto.pbkdf2(password, salt, 210_000, 64, 'sha512', (error, key) => error ? reject(error) : resolve(key)));
  return `pbkdf2-sha512$210000$${salt}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, iterationsText, salt, expectedHex] = encoded.split('$');
  if (algorithm !== 'pbkdf2-sha512' || !iterationsText || !salt || !expectedHex) return false;
  const derived = await new Promise<Buffer>((resolve, reject) => crypto.pbkdf2(password, salt, Number(iterationsText), 64, 'sha512', (error, key) => error ? reject(error) : resolve(key)));
  const expected = Buffer.from(expectedHex, 'hex');
  return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
}
