import 'dotenv/config';
import { Redis } from 'ioredis';
import { logger } from './logger.js';

const REDIS_URL = process.env.REDIS_URL;

if (!REDIS_URL) {
  throw new Error('REDIS_URL is not set');
}

export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: false,
});

redis.on('error', (err: Error) => {
  logger.error({ err }, 'Redis connection error');
});
