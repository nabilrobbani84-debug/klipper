import { parseRangeHeader } from '../shared/range.js';
import { createMediaToken, verifyMediaToken } from './auth.js';
import { numberVar, type Env } from './env.js';

export async function mediaUrl(env: Env, origin: string, key: string, userId: string, downloadName?: string): Promise<string> {
  const ttl = numberVar(env.MEDIA_URL_TTL_SECONDS, 6 * 3600);
  return `${origin}/media/${await createMediaToken({ key, userId, download: downloadName }, env.AUTH_SECRET, ttl)}`;
}

/** Streams an R2 object behind a signed, expiring token with HTTP Range support (video seeking). */
export async function serveMedia(request: Request, env: Env, token: string): Promise<Response> {
  const media = await verifyMediaToken(token, env.AUTH_SECRET);
  if (!media) return Response.json({ success: false, data: null, error: { code: 'MEDIA_LINK_EXPIRED', message: 'This media link has expired. Reload the page.' } }, { status: 403 });
  const head = await env.MEDIA_BUCKET.head(media.key);
  if (!head) return Response.json({ success: false, data: null, error: { code: 'NOT_FOUND', message: 'Media not found.' } }, { status: 404 });
  const size = head.size;
  const headers = new Headers({
    'accept-ranges': 'bytes',
    'content-type': head.httpMetadata?.contentType ?? (media.key.endsWith('.mov') ? 'video/quicktime' : 'video/mp4'),
    'cache-control': 'private, max-age=3600',
    'x-content-type-options': 'nosniff',
  });
  if (media.download) headers.set('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(media.download)}`);
  const range = parseRangeHeader(request.headers.get('range'), size);
  if (range === 'unsatisfiable') {
    headers.set('content-range', `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  if (range) {
    headers.set('content-range', `bytes ${range.start}-${range.end}/${size}`);
    headers.set('content-length', String(range.end - range.start + 1));
  } else {
    headers.set('content-length', String(size));
  }
  const status = range ? 206 : 200;
  if (request.method === 'HEAD') return new Response(null, { status, headers });
  const object = await env.MEDIA_BUCKET.get(media.key, range ? { range: { offset: range.start, length: range.end - range.start + 1 } } : undefined);
  if (!object) return new Response(null, { status: 404 });
  return new Response(object.body, { status, headers });
}
