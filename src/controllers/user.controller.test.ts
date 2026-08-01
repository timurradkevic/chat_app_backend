import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { userController } from './user.controller.js';
import { refreshTokenService } from '../services/refreshToken.service.js';
import { jwtService } from '../utils/jwt.js';
import { userService } from '../services/user.service.js';
import {
  assertIsCorrectEmailAndPassword,
  assertIsConfirmedEmail,
  assertIsValidRefreshToken,
  assertIsUser,
} from '../utils/checks.js';
import type { User } from '../generated/prisma/client.js';

// --- Mocks for the services/helpers the controller talks to ---
vi.mock('../services/refreshToken.service.js', () => ({
  refreshTokenService: {
    create: vi.fn(),
    verifyAndRotate: vi.fn(),
    findByRawToken: vi.fn(),
    revoke: vi.fn(),
    revokeAllForUser: vi.fn(),
    listSessions: vi.fn(),
  },
}));

vi.mock('../utils/jwt.js', () => ({
  jwtService: {
    sign: vi.fn(),
    verify: vi.fn(),
  },
}));

vi.mock('../services/user.service.js', () => ({
  userService: {
    getOneById: vi.fn(),
    getOneByEmail: vi.fn(),
    incrementTokenVersion: vi.fn(),
  },
}));

vi.mock('../utils/checks.js', () => ({
  assertIsCorrectEmailAndPassword: vi.fn(),
  assertIsConfirmedEmail: vi.fn(),
  assertIsValidRefreshToken: vi.fn(),
  assertIsUser: vi.fn(),
}));

// These are transitively imported by user.controller.ts. They throw or hit
// real infra at import time if left un-mocked, so they get lightweight
// stand-ins even though nothing in these tests exercises them directly.
vi.mock('../lib/prisma.js', () => ({ prisma: {} }));
vi.mock('../services/token.service.js', () => ({ tokenService: {} }));
vi.mock('../utils/email.js', () => ({ mailer: {} }));

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'user@example.com',
    name: 'Test User',
    password: 'hashed',
    confirmedEmail: true,
    googleId: null,
    tokenVersion: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeReq(overrides: Record<string, unknown> = {}): Request {
  return {
    body: {},
    headers: {},
    ...overrides,
  } as unknown as Request;
}

function makeRes(): Response {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  res.sendStatus = vi.fn().mockReturnValue(res);
  return res;
}

describe('userController', () => {
  let next: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    next = vi.fn();
  });

  describe('login', () => {
    it('returns an accessToken and refreshToken on successful login', async () => {
      const user = makeUser({ id: 'user-1', tokenVersion: 2 });
      vi.mocked(assertIsCorrectEmailAndPassword).mockResolvedValue(user);
      vi.mocked(assertIsConfirmedEmail).mockReturnValue(undefined);
      vi.mocked(refreshTokenService.create).mockResolvedValue({
        rawToken: 'raw-refresh-token',
        familyId: 'family-1',
      });
      vi.mocked(jwtService.sign).mockReturnValue('signed-access-token');

      const req = makeReq({
        body: {
          loginData: { email: 'user@example.com', password: 'Password1' },
        },
      });
      const res = makeRes();

      await userController.login(req, res, next);

      expect(assertIsCorrectEmailAndPassword).toHaveBeenCalledWith(
        'user@example.com',
        'Password1',
      );
      expect(assertIsConfirmedEmail).toHaveBeenCalledWith(user);
      expect(jwtService.sign).toHaveBeenCalledWith({
        userId: 'user-1',
        tokenVersion: 2,
        sessionId: 'family-1',
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith({
        accessToken: 'signed-access-token',
        refreshToken: 'raw-refresh-token',
      });
    });

    it('throws before a refresh token is created when the email is not confirmed', async () => {
      const user = makeUser({ confirmedEmail: false });
      vi.mocked(assertIsCorrectEmailAndPassword).mockResolvedValue(user);
      vi.mocked(assertIsConfirmedEmail).mockImplementation(() => {
        throw new Error('Email address is not confirmed yet');
      });

      const req = makeReq({
        body: {
          loginData: { email: 'user@example.com', password: 'Password1' },
        },
      });
      const res = makeRes();

      await expect(userController.login(req, res, next)).rejects.toThrow(
        'Email address is not confirmed yet',
      );

      expect(refreshTokenService.create).not.toHaveBeenCalled();
      expect(jwtService.sign).not.toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      expect(res.send).not.toHaveBeenCalled();
    });

    it('omits userAgent/ipAddress from the metadata when neither is present on the request', async () => {
      const user = makeUser({ id: 'user-1' });
      vi.mocked(assertIsCorrectEmailAndPassword).mockResolvedValue(user);
      vi.mocked(assertIsConfirmedEmail).mockReturnValue(undefined);
      vi.mocked(refreshTokenService.create).mockResolvedValue({
        rawToken: 'raw-refresh-token',
        familyId: 'family-1',
      });
      vi.mocked(jwtService.sign).mockReturnValue('signed-access-token');

      const req = makeReq({
        headers: {},
        ip: undefined,
        body: {
          loginData: { email: 'user@example.com', password: 'Password1' },
        },
      });
      const res = makeRes();

      await userController.login(req, res, next);

      expect(refreshTokenService.create).toHaveBeenCalledWith('user-1', {});
    });

    it('attaches only userAgent when the user-agent header is present but req.ip is not', async () => {
      const user = makeUser({ id: 'user-1' });
      vi.mocked(assertIsCorrectEmailAndPassword).mockResolvedValue(user);
      vi.mocked(assertIsConfirmedEmail).mockReturnValue(undefined);
      vi.mocked(refreshTokenService.create).mockResolvedValue({
        rawToken: 'raw-refresh-token',
        familyId: 'family-1',
      });
      vi.mocked(jwtService.sign).mockReturnValue('signed-access-token');

      const req = makeReq({
        headers: { 'user-agent': 'Mozilla/5.0' },
        ip: undefined,
        body: {
          loginData: { email: 'user@example.com', password: 'Password1' },
        },
      });
      const res = makeRes();

      await userController.login(req, res, next);

      expect(refreshTokenService.create).toHaveBeenCalledWith('user-1', {
        userAgent: 'Mozilla/5.0',
      });
    });

    it('attaches only ipAddress when req.ip is present but the user-agent header is not', async () => {
      const user = makeUser({ id: 'user-1' });
      vi.mocked(assertIsCorrectEmailAndPassword).mockResolvedValue(user);
      vi.mocked(assertIsConfirmedEmail).mockReturnValue(undefined);
      vi.mocked(refreshTokenService.create).mockResolvedValue({
        rawToken: 'raw-refresh-token',
        familyId: 'family-1',
      });
      vi.mocked(jwtService.sign).mockReturnValue('signed-access-token');

      const req = makeReq({
        headers: {},
        ip: '203.0.113.7',
        body: {
          loginData: { email: 'user@example.com', password: 'Password1' },
        },
      });
      const res = makeRes();

      await userController.login(req, res, next);

      expect(refreshTokenService.create).toHaveBeenCalledWith('user-1', {
        ipAddress: '203.0.113.7',
      });
    });

    it('attaches both userAgent and ipAddress when both are present on the request', async () => {
      const user = makeUser({ id: 'user-1' });
      vi.mocked(assertIsCorrectEmailAndPassword).mockResolvedValue(user);
      vi.mocked(assertIsConfirmedEmail).mockReturnValue(undefined);
      vi.mocked(refreshTokenService.create).mockResolvedValue({
        rawToken: 'raw-refresh-token',
        familyId: 'family-1',
      });
      vi.mocked(jwtService.sign).mockReturnValue('signed-access-token');

      const req = makeReq({
        headers: { 'user-agent': 'Mozilla/5.0' },
        ip: '203.0.113.7',
        body: {
          loginData: { email: 'user@example.com', password: 'Password1' },
        },
      });
      const res = makeRes();

      await userController.login(req, res, next);

      expect(refreshTokenService.create).toHaveBeenCalledWith('user-1', {
        userAgent: 'Mozilla/5.0',
        ipAddress: '203.0.113.7',
      });
    });
  });

  describe('refresh', () => {
    it('returns a new accessToken alongside the rotated refreshToken', async () => {
      vi.mocked(assertIsValidRefreshToken).mockResolvedValue({
        rawToken: 'new-raw-token',
        userId: 'user-1',
        familyId: 'family-1',
      });
      const user = makeUser({ id: 'user-1', tokenVersion: 5 });
      vi.mocked(assertIsUser).mockResolvedValue(user);
      vi.mocked(jwtService.sign).mockReturnValue('new-access-token');

      const req = makeReq({
        body: { refreshTokenData: { refreshToken: 'old-raw-token' } },
      });
      const res = makeRes();

      await userController.refresh(req, res, next);

      expect(assertIsValidRefreshToken).toHaveBeenCalledWith('old-raw-token');
      expect(assertIsUser).toHaveBeenCalledWith('user-1');
      expect(jwtService.sign).toHaveBeenCalledWith({
        userId: 'user-1',
        tokenVersion: 5,
        sessionId: 'family-1',
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith({
        accessToken: 'new-access-token',
        refreshToken: 'new-raw-token',
      });
    });
  });

  describe('logout', () => {
    it('revokes the refresh token when a matching token record is found', async () => {
      vi.mocked(refreshTokenService.findByRawToken).mockResolvedValue({
        id: 'token-1',
      } as never);

      const req = makeReq({
        body: { logoutData: { refreshToken: 'raw-token' } },
      });
      const res = makeRes();

      await userController.logout(req, res, next);

      expect(refreshTokenService.findByRawToken).toHaveBeenCalledWith(
        'raw-token',
      );
      expect(refreshTokenService.revoke).toHaveBeenCalledWith('token-1');
      expect(res.sendStatus).toHaveBeenCalledWith(204);
    });

    it('does not call revoke when no matching token record is found', async () => {
      vi.mocked(refreshTokenService.findByRawToken).mockResolvedValue(null);

      const req = makeReq({
        body: { logoutData: { refreshToken: 'unknown-token' } },
      });
      const res = makeRes();

      await userController.logout(req, res, next);

      expect(refreshTokenService.findByRawToken).toHaveBeenCalledWith(
        'unknown-token',
      );
      expect(refreshTokenService.revoke).not.toHaveBeenCalled();
      expect(res.sendStatus).toHaveBeenCalledWith(204);
    });
  });

  describe('logoutAll', () => {
    it('increments the tokenVersion and revokes every refresh token for the user', async () => {
      const req = makeReq({ user: { id: 'user-1' } });
      const res = makeRes();

      await userController.logoutAll(req, res, next);

      expect(userService.incrementTokenVersion).toHaveBeenCalledWith('user-1');
      expect(refreshTokenService.revokeAllForUser).toHaveBeenCalledWith(
        'user-1',
      );
      expect(res.sendStatus).toHaveBeenCalledWith(204);
    });
  });
});
