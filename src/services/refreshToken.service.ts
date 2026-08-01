import { createHash, randomBytes } from 'node:crypto';
import type { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';

const REUSE_GRACE_PERIOD_MS = 10 * 1000; // 10 seconds
const REUSE_GRACE_PERIOD_SECONDS = Math.ceil(REUSE_GRACE_PERIOD_MS / 1000);

/**
 * Redis key used to cache the result of a rotation for the grace-period
 * window. This is what makes a same-token retry inside the window
 * idempotent: the retry returns the *same* child token that was already
 * minted, instead of minting a brand-new independent child every time the
 * spent raw token is replayed. Without this, an attacker holding a
 * previously-used (rotated-away) raw token could keep "retrying" it inside
 * the window and would be handed a fresh, indistinguishable child token
 * on every attempt — defeating reuse detection entirely.
 */
function retryCacheKey(usedTokenHash: string) {
  return `refresh-retry:${usedTokenHash}`;
}

type CachedRotationResult = {
  rawToken: string;
  userId: string;
  familyId: string;
};

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
    const finalFamilyId =
      familyId ?? createHash('sha256').update(rawToken).digest('hex');

    const deviceLabel = meta?.userAgent?.substring(0, 255) ?? 'Unknown device';

    await prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiredTime,
        ...meta,
        deviceLabel,
        familyId: finalFamilyId,
        lastUsedAt: new Date(),
      },
    });

    return { rawToken, familyId: finalFamilyId };
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

      // Within the grace period: this is expected to be a harmless retry
      // (e.g. a duplicate request from the client), NOT a license to mint
      // another independent child token. Return the exact same child token
      // that was already issued the first time this raw token was rotated,
      // and do nothing else — no new DB row, no usedAt reset. That keeps
      // the grace window from being extendable by repeated replay, and
      // means an attacker replaying a stolen-but-already-used token can
      // never get a child of their own.
      const cachedRaw = await redis.get(retryCacheKey(token.tokenHash));

      if (!cachedRaw) {
        // No cached rotation result for this token within the grace
        // window — we can't safely treat this as a legitimate retry, so
        // fail closed and revoke the family, same as a reuse outside the
        // window.
        await prisma.refreshToken.deleteMany({
          where: { familyId: token.familyId },
        });

        return 'reused' as const;
      }

      const cached = JSON.parse(cachedRaw) as CachedRotationResult;
      return cached;
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

    const result: CachedRotationResult = {
      rawToken: newRawToken,
      userId: token.userId,
      familyId: token.familyId,
    };

    // Cache the rotation result for the grace window so a duplicate
    // request replaying the same (now-spent) raw token gets back the same
    // child token instead of triggering a fresh rotation.
    await redis.set(
      retryCacheKey(token.tokenHash),
      JSON.stringify(result),
      'EX',
      REUSE_GRACE_PERIOD_SECONDS,
    );

    return result;
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
        familyId: true,
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
