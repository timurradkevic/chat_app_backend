import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '../lib/prisma.js';

export const refreshTokenService = {
  async create(
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    const expiredTime = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    const deviceLabel = meta?.userAgent?.substring(0, 255) ?? 'Unknown device';

    await prisma.refreshToken.create({
      data: { userId, tokenHash, expiredTime, ...meta, deviceLabel },
    });

    return rawToken;
  },

  async verifyAndRotate(rawToken: string) {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const token = await prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (!token) {
      return null;
    }
    if (token.expiredTime < new Date()) {
      return 'expired' as const;
    }

    const newRawToken = randomBytes(32).toString('hex');
    const newTokenHash = createHash('sha256').update(newRawToken).digest('hex');
    const newExpiredTime = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    await prisma.refreshToken.update({
      where: { id: token.id },
      data: {
        tokenHash: newTokenHash,
        expiredTime: newExpiredTime,
        lastUsedAt: new Date(),
      },
    });

    return newRawToken;
  },

  async revoke(tokenId: string) {
    await prisma.refreshToken.delete({ where: { id: tokenId } });
  },

  async revokeAllForUser(userId: string) {
    await prisma.refreshToken.deleteMany({ where: { userId } });
  },

  async listSessions(userId: string) {
    return prisma.refreshToken.findMany({
      where: { userId },
      select: {
        id: true,
        deviceLabel: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
        lastUsedAt: true,
      },
      orderBy: { lastUsedAt: 'desc' },
    });
  },
};
