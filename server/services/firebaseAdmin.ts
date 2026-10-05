import type { AppConfig } from '../config.js';
import { AppError } from '../errors.js';

export interface VerifiedGoogleUser {
  uid: string;
  email: string;
  emailVerified: boolean;
}

/**
 * Verifies a Firebase ID token (from Google sign-in) server-side using firebase-admin.
 * The SDK is imported lazily so the dependency is only loaded when Google auth is configured,
 * and so unit/API tests don't need Firebase credentials.
 */
export class FirebaseVerifier {
  private app: unknown = null;
  private readonly configured: boolean;

  constructor(private readonly config: AppConfig) {
    this.configured = Boolean(config.FIREBASE_PROJECT_ID && (config.FIREBASE_SERVICE_ACCOUNT || config.FIREBASE_CLIENT_EMAIL));
  }

  get enabled(): boolean {
    return this.configured;
  }

  private async getAuth() {
    const admin = await import('firebase-admin');
    const credentials = this.config.FIREBASE_SERVICE_ACCOUNT
      ? JSON.parse(this.config.FIREBASE_SERVICE_ACCOUNT)
      : {
        projectId: this.config.FIREBASE_PROJECT_ID,
        clientEmail: this.config.FIREBASE_CLIENT_EMAIL,
        privateKey: (this.config.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
      };
    if (!this.app) {
      this.app = admin.apps.length > 0 ? admin.apps[0] : admin.initializeApp({ credential: admin.credential.cert(credentials), projectId: this.config.FIREBASE_PROJECT_ID });
    }
    return admin.auth(this.app as never);
  }

  async verify(idToken: string): Promise<VerifiedGoogleUser> {
    if (!this.configured) throw new AppError('GOOGLE_AUTH_DISABLED', 'Google sign-in is not configured on this server.', 503);
    try {
      const decoded = await (await this.getAuth()).verifyIdToken(idToken, true);
      if (!decoded.email) throw new AppError('GOOGLE_AUTH_NO_EMAIL', 'Your Google account did not provide an email address.', 400);
      return { uid: decoded.uid, email: decoded.email.toLowerCase(), emailVerified: Boolean(decoded.email_verified) };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('GOOGLE_AUTH_INVALID', 'Google sign-in could not be verified. Please try again.', 401);
    }
  }
}
