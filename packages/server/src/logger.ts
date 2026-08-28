import { pino } from 'pino';
import { loadConfig } from './config.js';

const config = loadConfig();

/**
 * Structured technical logging (spec §17, §37). User-facing messages are never
 * sourced from these strings — they come from AppError.userMessage.
 */
export const logger = pino({
  level: config.LOG_LEVEL,
  transport:
    config.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
      : undefined,
  redact: {
    paths: ['req.headers.cookie', 'req.headers.authorization', 'pin', 'passphrase', 'secretAccessKey'],
    remove: true,
  },
});
