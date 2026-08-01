import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  assertIsOwner,
  assertIsOwnerTryingToLeave,
  assertIsAdminOrOwner,
  assertHasHigherRole,
  assertHasNoOwnedRooms,
  assertIsUniqueEmail,
  assertIsCorrectEmailAndPassword,
  assertIsValidToken,
  assertIsConfirmedEmail,
  ForbiddenError,
  ConflictError,
  UnauthorizedError,
  GoneError,
} from './checks.js';
import { roomService } from '../services/room.service.js';
import { userService } from '../services/user.service.js';
import { tokenService } from '../services/token.service.js';
import { Role } from '../generated/prisma/enums.js';
import type { Token, User } from '../generated/prisma/client.js';

vi.mock('../services/room.service.js', () => ({
  roomService: {
    getMemberRole: vi.fn(),
    hasOwnedRoom: vi.fn(),
  },
}));

vi.mock('../services/user.service.js', () => ({
  userService: {
    getOneByEmail: vi.fn(),
    verifyPassword: vi.fn(),
  },
}));

vi.mock('../services/token.service.js', () => ({
  tokenService: {
    verify: vi.fn(),
  },
}));

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'user@example.com',
    name: 'Test',
    password: 'hashed',
    confirmedEmail: false,
    googleId: null,
    tokenVersion: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeToken(overrides: Partial<Token> = {}): Token {
  return {
    id: 'token-1',
    tokenHash: 'a'.repeat(64),
    userId: 'user-1',
    expiredTime: new Date(Date.now() + 60_000),
    type: 'ACTIVATION',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('room role checks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('assertIsOwner', () => {
    it('passes silently when the user is OWNER', async () => {
      vi.mocked(roomService.getMemberRole).mockResolvedValue(Role.OWNER);
      await expect(assertIsOwner('user-1', 'room-1')).resolves.toBeUndefined();
    });

    it('throws ForbiddenError for any other role', async () => {
      vi.mocked(roomService.getMemberRole).mockResolvedValue(Role.ADMIN);
      await expect(assertIsOwner('user-1', 'room-1')).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });
  });

  describe('assertIsOwnerTryingToLeave', () => {
    it('throws ConflictError when the owner tries to leave without transferring ownership first', async () => {
      vi.mocked(roomService.getMemberRole).mockResolvedValue(Role.OWNER);
      await expect(
        assertIsOwnerTryingToLeave('user-1', 'room-1'),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('does nothing for a non-owner leaving', async () => {
      vi.mocked(roomService.getMemberRole).mockResolvedValue(Role.MEMBER);
      await expect(
        assertIsOwnerTryingToLeave('user-1', 'room-1'),
      ).resolves.toBeUndefined();
    });
  });

  describe('assertIsAdminOrOwner', () => {
    it.each([Role.ADMIN, Role.OWNER])('passes for role %s', async (role) => {
      vi.mocked(roomService.getMemberRole).mockResolvedValue(role);
      await expect(
        assertIsAdminOrOwner('user-1', 'room-1'),
      ).resolves.toBeUndefined();
    });

    it('throws ForbiddenError for a plain MEMBER', async () => {
      vi.mocked(roomService.getMemberRole).mockResolvedValue(Role.MEMBER);
      await expect(
        assertIsAdminOrOwner('user-1', 'room-1'),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe('assertHasHigherRole (role hierarchy for member management)', () => {
    it('forbids a plain MEMBER from acting on anyone', async () => {
      vi.mocked(roomService.getMemberRole)
        .mockResolvedValueOnce(Role.MEMBER)
        .mockResolvedValueOnce(Role.MEMBER);

      await expect(
        assertHasHigherRole('actor', 'target', 'room-1'),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('forbids acting on the OWNER, even by another OWNER', async () => {
      vi.mocked(roomService.getMemberRole)
        .mockResolvedValueOnce(Role.OWNER)
        .mockResolvedValueOnce(Role.OWNER);

      await expect(
        assertHasHigherRole('actor', 'target', 'room-1'),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('forbids an ADMIN from acting on another ADMIN', async () => {
      vi.mocked(roomService.getMemberRole)
        .mockResolvedValueOnce(Role.ADMIN)
        .mockResolvedValueOnce(Role.ADMIN);

      await expect(
        assertHasHigherRole('actor', 'target', 'room-1'),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('forbids an ADMIN from promoting a MEMBER to ADMIN or OWNER', async () => {
      vi.mocked(roomService.getMemberRole)
        .mockResolvedValueOnce(Role.MEMBER)
        .mockResolvedValueOnce(Role.ADMIN);

      await expect(
        assertHasHigherRole('actor', 'target', 'room-1', Role.ADMIN),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('allows the OWNER to promote a MEMBER to ADMIN', async () => {
      vi.mocked(roomService.getMemberRole)
        .mockResolvedValueOnce(Role.MEMBER)
        .mockResolvedValueOnce(Role.OWNER);

      await expect(
        assertHasHigherRole('actor', 'target', 'room-1', Role.ADMIN),
      ).resolves.toBeUndefined();
    });

    it('allows an ADMIN to act on a plain MEMBER without changing their role', async () => {
      vi.mocked(roomService.getMemberRole)
        .mockResolvedValueOnce(Role.MEMBER)
        .mockResolvedValueOnce(Role.ADMIN);

      await expect(
        assertHasHigherRole('actor', 'target', 'room-1'),
      ).resolves.toBeUndefined();
    });
  });

  describe('assertHasNoOwnedRooms (blocks account deletion while owning rooms)', () => {
    it('throws ConflictError when the user still owns rooms', async () => {
      vi.mocked(roomService.hasOwnedRoom).mockResolvedValue(true);
      await expect(assertHasNoOwnedRooms('user-1')).rejects.toBeInstanceOf(
        ConflictError,
      );
    });

    it('passes when the user owns no rooms', async () => {
      vi.mocked(roomService.hasOwnedRoom).mockResolvedValue(false);
      await expect(assertHasNoOwnedRooms('user-1')).resolves.toBeUndefined();
    });
  });
});

describe('auth-related checks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('assertIsUniqueEmail', () => {
    it('throws ConflictError when the email is already taken', async () => {
      vi.mocked(userService.getOneByEmail).mockResolvedValue(makeUser());
      await expect(
        assertIsUniqueEmail('taken@example.com'),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('passes when the email is free', async () => {
      vi.mocked(userService.getOneByEmail).mockResolvedValue(null);
      await expect(assertIsUniqueEmail('free@example.com')).resolves.toBeNull();
    });
  });

  describe('assertIsCorrectEmailAndPassword', () => {
    it('throws UnauthorizedError when no user matches the email', async () => {
      vi.mocked(userService.getOneByEmail).mockResolvedValue(null);
      await expect(
        assertIsCorrectEmailAndPassword('nobody@example.com', 'pass'),
      ).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it('throws UnauthorizedError when the password does not match', async () => {
      vi.mocked(userService.getOneByEmail).mockResolvedValue(makeUser());
      vi.mocked(userService.verifyPassword).mockResolvedValue(false);

      await expect(
        assertIsCorrectEmailAndPassword('user@example.com', 'wrong'),
      ).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it('returns the user when the email and password are both correct', async () => {
      const user = makeUser();
      vi.mocked(userService.getOneByEmail).mockResolvedValue(user);
      vi.mocked(userService.verifyPassword).mockResolvedValue(true);

      await expect(
        assertIsCorrectEmailAndPassword('user@example.com', 'correct'),
      ).resolves.toEqual(user);
    });
  });

  describe('assertIsConfirmedEmail', () => {
    it('throws ForbiddenError when the email is not confirmed', () => {
      expect(() =>
        assertIsConfirmedEmail(makeUser({ confirmedEmail: false })),
      ).toThrow(ForbiddenError);
    });

    it('does not throw when the email is confirmed', () => {
      expect(() =>
        assertIsConfirmedEmail(makeUser({ confirmedEmail: true })),
      ).not.toThrow();
    });
  });

  describe('assertIsValidToken (activation token validity)', () => {
    it('throws GoneError when the token is expired — distinct from "not found"', async () => {
      vi.mocked(tokenService.verify).mockResolvedValue('expired');
      await expect(
        assertIsValidToken('raw-token', 'ACTIVATION'),
      ).rejects.toBeInstanceOf(GoneError);
    });

    it('throws UnauthorizedError when the token is not found or invalid', async () => {
      vi.mocked(tokenService.verify).mockResolvedValue(null);
      await expect(
        assertIsValidToken('raw-token', 'ACTIVATION'),
      ).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it('returns the token record when it is valid', async () => {
      const token = makeToken();
      vi.mocked(tokenService.verify).mockResolvedValue(token);

      await expect(
        assertIsValidToken('raw-token', 'ACTIVATION'),
      ).resolves.toEqual(token);
    });
  });
});
