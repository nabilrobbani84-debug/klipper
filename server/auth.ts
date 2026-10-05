import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type { NextFunction, Request, Response } from 'express';
import type { AppConfig } from './config.js';
import { AppError } from './errors.js';
import type { AuthenticatedUser, UserRole } from './types.js';

const pbkdf2 = promisify(crypto.pbkdf2);
const PBKDF2_ITERATIONS = 210_000;

type SessionPayload = { sub: string; email?: string; role?: UserRole; exp: number; jti: string };

function sign(value: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createSessionToken(user: AuthenticatedUser, secret: string, ttlSeconds: number): { token: string; expiresAt: Date } {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  const payload: SessionPayload = { sub: user.id, email: user.email, role: user.role, exp: Math.floor(expiresAt.getTime() / 1000), jti: crypto.randomUUID() };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return { token: `${encoded}.${sign(encoded, secret)}`, expiresAt };
}

export function verifySessionToken(token: string, secret: string): AuthenticatedUser | null {
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature || !safeEqual(signature, sign(encoded, secret))) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString()) as SessionPayload;
    if (!payload.sub || !payload.jti || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return { id: payload.sub, email: payload.email, role: payload.role };
  } catch {
    return null;
  }
}

export function getBearerToken(req: Request): string | null {
  const authorization = req.header('authorization');
  return authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() || null : null;
}

export interface SessionLookup {
  /** Returns the current user for an active (non-revoked, non-expired) session, or null. */
  findActiveSession(tokenHash: string): Promise<AuthenticatedUser | null>;
}

export function requireAuth(config: AppConfig, sessions: SessionLookup) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const bearer = getBearerToken(req);
    const run = async () => {
      if (bearer && verifySessionToken(bearer, config.AUTH_SECRET)) {
        const user = await sessions.findActiveSession(hashSessionToken(bearer));
        if (!user) throw new AppError('SESSION_EXPIRED', 'Your session has expired. Please sign in again.', 401);
        req.user = user;
        req.sessionToken = bearer;
        return;
      }
      if (config.NODE_ENV !== 'production' && config.ALLOW_DEV_AUTH) {
        req.user = { id: req.header('x-dev-user-id') || 'local-development-user', role: req.header('x-dev-role') === 'admin' ? 'admin' : 'user' };
        return;
      }
      throw new AppError('UNAUTHENTICATED', 'Sign in is required.', 401);
    };
    run().then(() => next(), next);
  };
}

export function requireAdmin(req: Request): void {
  if (req.user?.role !== 'admin') throw new AppError('FORBIDDEN', 'Administrator access is required.', 403);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await pbkdf2(password, salt, PBKDF2_ITERATIONS, 64, 'sha512');
  return `pbkdf2-sha512$${PBKDF2_ITERATIONS}$${salt}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, iterationsText, salt, expectedHex] = encoded.split('$');
  const iterations = Number(iterationsText);
  if (algorithm !== 'pbkdf2-sha512' || !Number.isInteger(iterations) || iterations < 1 || !salt || !expectedHex) return false;
  const derived = await pbkdf2(password, salt, iterations, 64, 'sha512');
  const expected = Buffer.from(expectedHex, 'hex');
  return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
}

/** Short-lived signed URLs for <video> elements and downloads, which cannot send Authorization headers. */
export function createMediaToken(input: { key: string; userId: string; download?: string }, secret: string, ttlSeconds: number): string {
  const payload = { k: input.key, u: input.userId, d: input.download, e: Math.floor(Date.now() / 1000) + ttlSeconds };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${sign(`media:${encoded}`, secret)}`;
}

export function verifyMediaToken(token: string, secret: string): { key: string; userId: string; download?: string } | null {
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature || !safeEqual(signature, sign(`media:${encoded}`, secret))) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString()) as { k?: string; u?: string; d?: string; e?: number };
    if (!payload.k || !payload.u || !payload.e || payload.e <= Math.floor(Date.now() / 1000)) return null;
    if (!payload.k.startsWith(`users/${payload.u}/`)) return null;
    return { key: payload.k, userId: payload.u, download: payload.d };
  } catch {
    return null;
  }
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      sessionToken?: string;
    }
  }
}
