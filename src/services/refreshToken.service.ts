import { createHash, randomBytes } from 'node:crypto';
import type { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../lib/prisma.js';

const REUSE_GRACE_PERIOD_MS = 10 * 1000; // 10 seconds

type Tx = Prisma.TransactionClient | typeof prisma;

export const refreshTokenService = {
  async create(
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
    familyId?: string,
  ) {
    const expiredTime = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    const deviceLabel = meta?.userAgent?.substring(0, 255) ?? 'Unknown device';

    await prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiredTime,
        ...meta,
        deviceLabel,
        familyId:
          familyId ?? createHash('sha256').update(rawToken).digest('hex'),
      },
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

    if (token.usedAt !== null) {
      const elapsedSinceUse = Date.now() - token.usedAt.getTime();

      if (elapsedSinceUse > REUSE_GRACE_PERIOD_MS) {
        await prisma.refreshToken.deleteMany({
          where: { familyId: token.familyId },
        });

        return 'reused' as const;
      }
    }

    if (token.expiredTime < new Date()) {
      return 'expired' as const;
    }

    const newRawToken = randomBytes(32).toString('hex');
    const newTokenHash = createHash('sha256').update(newRawToken).digest('hex');
    const newExpiredTime = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    await prisma.$transaction([
      prisma.refreshToken.update({
        where: { id: token.id },
        data: { usedAt: new Date(), lastUsedAt: new Date() },
      }),
      prisma.refreshToken.create({
        data: {
          userId: token.userId,
          tokenHash: newTokenHash,
          familyId: token.familyId,
          expiredTime: newExpiredTime,
          userAgent: token.userAgent,
          ipAddress: token.ipAddress,
          deviceLabel: token.deviceLabel,
        },
      }),
    ]);

    return { rawToken: newRawToken, userId: token.userId };
  },

  async findByRawToken(rawToken: string) {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    return prisma.refreshToken.findUnique({ where: { tokenHash } });
  },

  async revoke(tokenId: string) {
    await prisma.refreshToken.delete({ where: { id: tokenId } });
  },

  async revokeAllForUser(userId: string, tx: Tx = prisma) {
    await tx.refreshToken.deleteMany({ where: { userId } });
  },

  async listSessions(userId: string) {
    return prisma.refreshToken.findMany({
      where: { userId, usedAt: null },
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
