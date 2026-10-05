import { loadConfig, type AppConfig } from '../config.js';

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    AUTH_SECRET: 'test-secret-value-that-is-long-enough-123456',
    LOG_LEVEL: 'silent',
    SERVE_FRONTEND: 'false',
    APP_URL: 'http://localhost:8080',
    STORAGE_DIR: './.runtime/test-storage',
    TEMP_DIR: './.runtime/test-tmp',
    ...overrides,
  });
}
