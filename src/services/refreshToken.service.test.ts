import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { refreshTokenService } from './refreshToken.service.js';
import { prisma } from '../lib/prisma.js';
import type { RefreshToken } from '../generated/prisma/client.js';

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    refreshToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

// In-memory fake store backing the mocked prisma.refreshToken methods.
// This lets us assert on real persistence semantics (e.g. that two rows
// created for the same userId both continue to exist), rather than just
// asserting on call arguments.
let rows: RefreshToken[] = [];
let nextId = 1;

function hash(raw: string) {
  return createHash('sha256').update(raw).digest('hex');
}

function resetStore() {
  rows = [];
  nextId = 1;
}

describe('refreshTokenService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();

    vi.mocked(prisma.refreshToken.create).mockImplementation((async ({
      data,
    }: {
      data: Partial<RefreshToken> & {
        userId: string;
        tokenHash: string;
        expiredTime: Date;
      };
    }) => {
      const row = {
        id: `token-${nextId++}`,
        tokenHash: data.tokenHash,
        userId: data.userId,
        expiredTime: data.expiredTime,
        userAgent: data.userAgent ?? null,
        ipAddress:
          (data as unknown as { ipAddress?: string }).ipAddress ?? null,
        deviceLabel: data.deviceLabel ?? null,
        lastUsedAt: data.lastUsedAt ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as RefreshToken;
      rows.push(row);
      return row;
    }) as unknown as typeof prisma.refreshToken.create);

    vi.mocked(prisma.refreshToken.findUnique).mockImplementation((async ({
      where,
    }: {
      where: { tokenHash?: string; id?: string };
    }) => {
      if (where.tokenHash) {
        return rows.find((r) => r.tokenHash === where.tokenHash) ?? null;
      }
      if (where.id) {
        return rows.find((r) => r.id === where.id) ?? null;
      }
      return null;
    }) as unknown as typeof prisma.refreshToken.findUnique);

    vi.mocked(prisma.refreshToken.update).mockImplementation((async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<RefreshToken>;
    }) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error('Record not found');
      Object.assign(row, data);
      return row;
    }) as unknown as typeof prisma.refreshToken.update);

    vi.mocked(prisma.refreshToken.delete).mockImplementation((async ({
      where,
    }: {
      where: { id: string };
    }) => {
      const index = rows.findIndex((r) => r.id === where.id);
      if (index === -1) throw new Error('Record not found');
      const [removed] = rows.splice(index, 1);
      return removed;
    }) as unknown as typeof prisma.refreshToken.delete);

    vi.mocked(prisma.refreshToken.deleteMany).mockImplementation((async ({
      where,
    }: {
      where: { userId: string };
    }) => {
      const before = rows.length;
      rows = rows.filter((r) => r.userId !== where.userId);
      return { count: before - rows.length };
    }) as unknown as typeof prisma.refreshToken.deleteMany);
  });

  describe('create', () => {
    it('supports multiple concurrent sessions: two calls for the same userId both persist as separate rows', async () => {
      await refreshTokenService.create('user-a');
      await refreshTokenService.create('user-b');

      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.userId).sort()).toEqual(['user-a', 'user-b']);

      // Now call twice with the same userId (e.g. logging in from two devices).
      await refreshTokenService.create('user-a');
      await refreshTokenService.create('user-a');

      const userARows = rows.filter((r) => r.userId === 'user-a');
      // Regression check: both sessions for user-a must coexist, not replace one another.
      expect(userARows).toHaveLength(3);
      expect(rows).toHaveLength(4);

      // All tokenHashes should be distinct (no collisions/overwrites).
      const hashes = new Set(rows.map((r) => r.tokenHash));
      expect(hashes.size).toBe(rows.length);
    });
  });

  describe('verifyAndRotate', () => {
    it('rotates a valid token: returns a new raw token, and the old tokenHash is no longer findable', async () => {
      const rawToken = await refreshTokenService.create('user-1');
      const oldTokenHash = hash(rawToken);
      expect(rows.find((r) => r.tokenHash === oldTokenHash)).toBeDefined();

      const result = await refreshTokenService.verifyAndRotate(rawToken);

      expect(result).not.toBeNull();
      expect(result).not.toBe('expired');
      expect(typeof result).toBe('string');
      expect(result).not.toBe(rawToken);

      // Old token hash must no longer be present in the store.
      expect(rows.find((r) => r.tokenHash === oldTokenHash)).toBeUndefined();

      // New token hash must be findable and verifiable.
      const newRawToken = result as string;
      const newTokenHash = hash(newRawToken);
      expect(rows.find((r) => r.tokenHash === newTokenHash)).toBeDefined();
    });

    it("returns 'expired' for a token whose expiredTime is in the past", async () => {
      const rawToken = await refreshTokenService.create('user-1');
      const tokenHash = hash(rawToken);
      const row = rows.find((r) => r.tokenHash === tokenHash);
      if (!row) throw new Error('setup failed: token row not found');
      row.expiredTime = new Date(Date.now() - 1000);

      const result = await refreshTokenService.verifyAndRotate(rawToken);

      expect(result).toBe('expired');
      // Expired token must not be rotated/consumed.
      expect(rows.find((r) => r.tokenHash === tokenHash)).toBeDefined();
    });

    it('returns null for a token that does not exist', async () => {
      const result = await refreshTokenService.verifyAndRotate(
        'non-existent-raw-token',
      );

      expect(result).toBeNull();
    });
  });

  describe('revoke', () => {
    it('deletes only the specified row by id, leaving other rows for the same user intact', async () => {
      await refreshTokenService.create('user-1');
      await refreshTokenService.create('user-1');
      expect(rows).toHaveLength(2);

      const [first, second] = rows;

      await refreshTokenService.revoke(first?.id ?? '');

      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(second?.id);
    });
  });

  describe('revokeAllForUser', () => {
    it('deletes all rows for the given userId without affecting other users', async () => {
      await refreshTokenService.create('user-1');
      await refreshTokenService.create('user-1');
      await refreshTokenService.create('user-2');
      expect(rows).toHaveLength(3);

      await refreshTokenService.revokeAllForUser('user-1');

      expect(rows).toHaveLength(1);
      expect(rows.every((r) => r.userId === 'user-2')).toBe(true);
    });
  });
});
