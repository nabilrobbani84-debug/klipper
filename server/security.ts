import { URL } from 'url';

/**
 * SSRF Protection and Security Verification Layer
 */
const BLOCKED_IP_PATTERNS = [
  /^127\./,                 // Loopback 127.0.0.0/8
  /^10\./,                  // Private Class A 10.0.0.0/8
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // Private Class B 172.16.0.0/12
  /^192\.168\./,            // Private Class C 192.168.0.0/16
  /^169\.254\./,            // Link-local / Cloud metadata 169.254.0.0/16
  /^0\.0\.0\.0/,            // Zero address
  /^::1$/,                  // IPv6 loopback
  /^fc00:/,                 // IPv6 private
  /^fe80:/,                 // IPv6 link-local
];

const ALLOWED_VIDEO_DOMAINS = [
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
  'commondatastorage.googleapis.com',
  'storage.googleapis.com',
  'images.unsplash.com',
  'i.ytimg.com',
];

export interface ValidationResult {
  isValid: boolean;
  sanitizedUrl?: string;
  error?: string;
}

export function validateVideoUrl(inputUrl: string): ValidationResult {
  if (!inputUrl || typeof inputUrl !== 'string') {
    return { isValid: false, error: 'URL is required' };
  }

  const trimmed = inputUrl.trim();

  // Allow standard 11-char YouTube ID shortcut
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return {
      isValid: true,
      sanitizedUrl: `https://www.youtube.com/watch?v=${trimmed}`,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { isValid: false, error: 'Malformed URL format' };
  }

  // Must be HTTPS or HTTP
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { isValid: false, error: 'Only HTTP and HTTPS protocols are allowed' };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Check SSRF blocked IP patterns
  for (const pattern of BLOCKED_IP_PATTERNS) {
    if (pattern.test(hostname)) {
      return { isValid: false, error: 'Forbidden host: Private or internal address blocked (SSRF Protection)' };
    }
  }

  // Check metadata hostnames
  if (
    hostname === 'localhost' ||
    hostname === 'metadata.google.internal' ||
    hostname === 'instance-data' ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.local')
  ) {
    return { isValid: false, error: 'Forbidden host: Internal network access blocked' };
  }

  // Check domain whitelist
  const isAllowedDomain = ALLOWED_VIDEO_DOMAINS.some(
    d => hostname === d || hostname.endsWith(`.${d}`)
  );

  if (!isAllowedDomain) {
    return {
      isValid: false,
      error: `Domain '${hostname}' is not authorized. Please provide a valid YouTube URL.`,
    };
  }

  return { isValid: true, sanitizedUrl: parsed.href };
}

/**
 * In-memory sliding window rate limiter
 */
interface RateLimitBucket {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitBucket>();

export function checkRateLimit(key: string, limit: number = 30, windowSeconds: number = 60): {
  allowed: boolean;
  remaining: number;
  resetSeconds: number;
} {
  const now = Date.now();
  let bucket = rateLimitStore.get(key);

  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 1, resetAt: now + windowSeconds * 1000 };
    rateLimitStore.set(key, bucket);
    return { allowed: true, remaining: limit - 1, resetSeconds: windowSeconds };
  }

  if (bucket.count >= limit) {
    const resetSeconds = Math.ceil((bucket.resetAt - now) / 1000);
    return { allowed: false, remaining: 0, resetSeconds };
  }

  bucket.count++;
  const resetSeconds = Math.ceil((bucket.resetAt - now) / 1000);
  return { allowed: true, remaining: limit - bucket.count, resetSeconds };
}
