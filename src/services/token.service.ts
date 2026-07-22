import { createHash, randomBytes } from 'node:crypto';
import type { Token, TokenTypes } from '../generated/prisma/client.js';
import { prisma } from '../lib/prisma.js';

type TokenData = Pick<Token, 'userId' | 'type'>;

const EXPIRATION_MS: Record<TokenTypes, number> = {
  ACTIVATION: 24 * 60 * 60 * 1000,
  RESET: 30 * 60 * 1000,
};

export const tokenService = {
  async create(tokenData: TokenData) {
    const expiredTime = new Date(Date.now() + EXPIRATION_MS[tokenData.type]);
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    await prisma.token.create({ data: { ...tokenData, tokenHash, expiredTime } });

    return rawToken;
  },
};
