import crypto from 'crypto';
import { UserAccount } from '../src/types';

export interface UserSession {
  userId: string;
  token: string;
  expiresAt: number;
}

export class AuthService {
  private static instance: AuthService;
  private users: Map<string, UserAccount & { passwordHash?: string; id: string }> = new Map();
  private sessions: Map<string, UserSession> = new Map();

  private constructor() {
    // Seed default admin creator
    const defaultUser: UserAccount & { id: string } = {
      id: 'usr_default',
      name: 'Alex Vance',
      email: 'creator@clipforge.ai',
      avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
      plan: 'creator',
      credits: 120,
      minutesUsed: 42,
      minutesLimit: 180,
      clipsGenerated: 28,
      storageMbUsed: 215,
      storageMbLimit: 1000,
    };
    this.users.set(defaultUser.id, defaultUser);
    this.users.set(defaultUser.email, defaultUser);
  }

  public static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  public register(name: string, email: string): { user: UserAccount; token: string } {
    const userId = `usr_${Date.now()}`;
    const newUser: UserAccount & { id: string } = {
      id: userId,
      name,
      email,
      avatarUrl: `https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80`,
      plan: 'free',
      credits: 60,
      minutesUsed: 0,
      minutesLimit: 60,
      clipsGenerated: 0,
      storageMbUsed: 0,
      storageMbLimit: 500,
    };

    this.users.set(userId, newUser);
    this.users.set(email, newUser);

    const token = this.createSession(userId);
    return { user: newUser, token };
  }

  public login(email: string): { user: UserAccount; token: string } | null {
    const user = this.users.get(email) || this.users.get('creator@clipforge.ai');
    if (!user) return null;

    const token = this.createSession(user.id);
    return { user, token };
  }

  public googleLogin(googleName?: string, googleEmail?: string): { user: UserAccount; token: string } {
    const email = googleEmail || 'cs.beliakuncom@gmail.com';
    const name = googleName || 'Google Creator';

    let user = this.users.get(email);
    if (!user) {
      const registered = this.register(name, email);
      user = registered.user as any;
    }

    const token = this.createSession((user as any).id);
    return { user: user!, token };
  }

  public createSession(userId: string): string {
    const token = `sess_${crypto.randomBytes(24).toString('hex')}`;
    this.sessions.set(token, {
      userId,
      token,
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
    });
    return token;
  }

  public verifySession(token: string): UserAccount | null {
    const session = this.sessions.get(token);
    if (!session || session.expiresAt < Date.now()) {
      return null;
    }
    const user = this.users.get(session.userId);
    return user || null;
  }

  public deductCredits(userId: string, creditsToDeduct: number, minutesToDeduct: number = 0): {
    success: boolean;
    remainingCredits: number;
    error?: string;
  } {
    const user = this.users.get(userId) || this.users.get('usr_default');
    if (!user) {
      return { success: false, remainingCredits: 0, error: 'User not found' };
    }

    if (user.credits < creditsToDeduct) {
      return {
        success: false,
        remainingCredits: user.credits,
        error: `Insufficient credits. You need ${creditsToDeduct} credits but have ${user.credits}. Please upgrade your plan.`,
      };
    }

    if (user.minutesUsed + minutesToDeduct > user.minutesLimit) {
      return {
        success: false,
        remainingCredits: user.credits,
        error: `Monthly video processing quota reached (${user.minutesUsed}/${user.minutesLimit} mins). Upgrade plan for higher limits.`,
      };
    }

    user.credits -= creditsToDeduct;
    user.minutesUsed += minutesToDeduct;
    user.clipsGenerated += 1;

    return { success: true, remainingCredits: user.credits };
  }
}
