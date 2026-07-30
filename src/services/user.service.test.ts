import { describe, it, expect, vi, beforeEach } from 'vitest';
import bcrypt from 'bcrypt';
import { userService } from './user.service.js';
import { prisma } from '../lib/prisma.js';
import type { User } from '../generated/prisma/client.js';
import { TokenTypes } from '../generated/prisma/enums.js';

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    token: {
      deleteMany: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

type TransactionClient = Parameters<typeof prisma.$transaction>[0] extends (
  tx: infer T,
) => unknown
  ? T
  : never;

type UserCreateArgs = Parameters<typeof prisma.user.create>[0];

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test',
    password: null,
    confirmedEmail: false,
    googleId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('userService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('hashes the password before saving it — the plain password is never persisted', async () => {
      vi.mocked(prisma.user.create).mockImplementation(
        (async ({ data }: UserCreateArgs) =>
          makeUser({
            email: data.email,
            name: data.name,
            password: (data.password as string | null | undefined) ?? null,
          })) as unknown as typeof prisma.user.create,
      );

      const user = await userService.create({
        email: 'test@example.com',
        name: 'Test',
        password: 'PlainPassword1',
      });

      expect(user.password).not.toBe('PlainPassword1');
      expect(await bcrypt.compare('PlainPassword1', user.password as string)).toBe(true);
    });
  });

  describe('createFromGoogle', () => {
    it('creates a user with confirmedEmail=true and password=null', async () => {
      vi.mocked(prisma.user.create).mockImplementation(
        (async ({ data }: UserCreateArgs) =>
          makeUser({
            email: data.email,
            name: data.name,
            googleId: (data.googleId as string | null | undefined) ?? null,
            confirmedEmail: Boolean(data.confirmedEmail),
            password: null,
          })) as unknown as typeof prisma.user.create,
      );

      const user = await userService.createFromGoogle({
        email: 'test@example.com',
        name: 'Test',
        googleId: 'google-123',
      });

      expect(user.password).toBeNull();
      expect(user.confirmedEmail).toBe(true);
      expect(user.googleId).toBe('google-123');
    });
  });

  describe('verifyPassword', () => {
    it('returns true for a matching password', async () => {
      const hash = await bcrypt.hash('CorrectPass1', 10);
      const user = makeUser({ password: hash });

      expect(await userService.verifyPassword(user, 'CorrectPass1')).toBe(true);
    });

    it('returns false for a non-matching password', async () => {
      const hash = await bcrypt.hash('CorrectPass1', 10);
      const user = makeUser({ password: hash });

      expect(await userService.verifyPassword(user, 'WrongPass1')).toBe(false);
    });

    it('returns false without throwing for a Google account that has no password', async () => {
      const user = makeUser({ password: null });

      await expect(userService.verifyPassword(user, 'AnyPassword1')).resolves.toBe(false);
    });
  });

  describe('confirmEmail', () => {
    it('marks the user as confirmed and deletes the used token in a single transaction', async () => {
      const tx = {
        user: {
          update: vi
            .fn<TransactionClient['user']['update']>()
            .mockResolvedValue(makeUser({ confirmedEmail: true })),
        },
        token: { delete: vi.fn<TransactionClient['token']['delete']>() },
      };

      vi.mocked(prisma.$transaction).mockImplementation(async (cb) =>
        cb(tx as unknown as TransactionClient),
      );

      await userService.confirmEmail('user-1', 'token-1');

      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { confirmedEmail: true },
      });
      expect(tx.token.delete).toHaveBeenCalledWith({ where: { id: 'token-1' } });
    });
  });

  describe('linkGoogleId', () => {
    it('confirms the email, links the googleId, and clears leftover activation tokens', async () => {
      const tx = {
        user: {
          update: vi
            .fn<TransactionClient['user']['update']>()
            .mockResolvedValue(makeUser({ confirmedEmail: true, googleId: 'google-123' })),
        },
        token: { deleteMany: vi.fn<TransactionClient['token']['deleteMany']>() },
      };

      vi.mocked(prisma.$transaction).mockImplementation(async (cb) =>
        cb(tx as unknown as TransactionClient),
      );

      await userService.linkGoogleId('user-1', 'google-123');

      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { confirmedEmail: true, googleId: 'google-123' },
      });
      expect(tx.token.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', type: TokenTypes.ACTIVATION },
      });
    });
  });
});
