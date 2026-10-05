import { createRemoteJWKSet, jwtVerify } from 'jose';
import { AppError } from '../shared/errors.js';
import { base64UrlDecode, base64UrlEncode, constantTimeEqual, hmacSign } from './crypto.js';

/**
 * Short-lived signed URLs for <video> elements and downloads (they cannot send Authorization headers).
 * The token binds the R2 key to its owner's prefix and an expiry.
 */
export async function createMediaToken(input: { key: string; userId: string; download?: string }, secret: string, ttlSeconds: number): Promise<string> {
  const payload = { k: input.key, u: input.userId, d: input.download, e: Math.floor(Date.now() / 1000) + ttlSeconds };
  const encoded = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  return `${encoded}.${await hmacSign(`media:${encoded}`, secret)}`;
}

export async function verifyMediaToken(token: string, secret: string): Promise<{ key: string; userId: string; download?: string } | null> {
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;
  if (!constantTimeEqual(signature, await hmacSign(`media:${encoded}`, secret))) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encoded))) as { k?: string; u?: string; d?: string; e?: number };
    if (!payload.k || !payload.u || !payload.e || payload.e <= Math.floor(Date.now() / 1000)) return null;
    if (!payload.k.startsWith(`users/${payload.u}/`) || payload.k.includes('..')) return null;
    return { key: payload.k, userId: payload.u, download: payload.d };
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------- Firebase (Google sign-in)

const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));

export interface VerifiedGoogleUser {
  uid: string;
  email: string;
  emailVerified: boolean;
}

/** Verifies a Firebase ID token against Google's public keys (no service account needed). */
export async function verifyFirebaseIdToken(idToken: string, projectId: string): Promise<VerifiedGoogleUser> {
  try {
    const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
      algorithms: ['RS256'],
    });
    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
    if (!payload.sub || !email) throw new AppError('GOOGLE_AUTH_NO_EMAIL', 'Your Google account did not provide an email address.', 400);
    return { uid: payload.sub, email, emailVerified: payload.email_verified === true };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('GOOGLE_AUTH_INVALID', 'Google sign-in could not be verified. Please try again.', 401);
  }
}
