import crypto from 'node:crypto';
import pino from 'pino';
import pinoHttp from 'pino-http';
import type { AppConfig } from './config.js';

export function createLogger(config: AppConfig) {
  return pino({ level: config.LOG_LEVEL, base: undefined });
}

export function requestLogger(logger: pino.Logger) {
  return pinoHttp({ logger, genReqId: (req) => String(req.headers['x-request-id'] || crypto.randomUUID()) });
}
