import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { pino, type Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import type { AppConfig } from './config.js';

export function createLogger(config: Pick<AppConfig, 'LOG_LEVEL'>): Logger {
  return pino({
    level: config.LOG_LEVEL,
    base: undefined,
    redact: { paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token'], remove: true },
  });
}

export function requestLogger(logger: Logger) {
  return pinoHttp({
    logger,
    genReqId: (req: IncomingMessage) => {
      const header = req.headers['x-request-id'];
      return typeof header === 'string' && /^[\w-]{8,64}$/.test(header) ? header : crypto.randomUUID();
    },
    autoLogging: { ignore: (req: IncomingMessage) => req.url === '/health' || req.url === '/ready' },
  });
}
