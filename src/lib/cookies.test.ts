import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Response } from 'express';
import { setRefreshTokenCookie, clearRefreshTokenCookie } from './cookies.js';
import { REFRESH_TOKEN_EXPIRATION_MS } from '../services/refreshToken.service.js';

function makeRes(): Response {
  const res = {} as Response;
  res.cookie = vi.fn().mockReturnValue(res);
  res.clearCookie = vi.fn().mockReturnValue(res);
  return res;
}

describe('cookies', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  describe('setRefreshTokenCookie', () => {
    it('sets an httpOnly cookie with the raw token, correct name, and maxAge', () => {
      const res = makeRes();

      setRefreshTokenCookie(res, 'raw-token-value');

      expect(res.cookie).toHaveBeenCalledWith(
        'refreshToken',
        'raw-token-value',
        expect.objectContaining({
          httpOnly: true,
          path: '/',
          maxAge: REFRESH_TOKEN_EXPIRATION_MS,
        }),
      );
    });

    it('sets secure: true in production', () => {
      process.env.NODE_ENV = 'production';
      const res = makeRes();

      setRefreshTokenCookie(res, 'raw-token-value');

      expect(res.cookie).toHaveBeenCalledWith(
        'refreshToken',
        'raw-token-value',
        expect.objectContaining({ secure: true }),
      );
    });

    it('sets secure: false outside production', () => {
      process.env.NODE_ENV = 'development';
      const res = makeRes();

      setRefreshTokenCookie(res, 'raw-token-value');

      expect(res.cookie).toHaveBeenCalledWith(
        'refreshToken',
        'raw-token-value',
        expect.objectContaining({ secure: false }),
      );
    });
  });

  describe('clearRefreshTokenCookie', () => {
    it('clears the cookie using the same name/path so the browser actually removes it', () => {
      const res = makeRes();

      clearRefreshTokenCookie(res);

      expect(res.clearCookie).toHaveBeenCalledWith(
        'refreshToken',
        expect.objectContaining({ path: '/' }),
      );
    });

    // Regression guard: clearCookie only removes a cookie if httpOnly,
    // secure, sameSite, and path all match what was originally set —
    // a mismatch here silently fails to log the user out client-side.
    it('uses the same httpOnly/secure/sameSite options as setRefreshTokenCookie', () => {
      type CookieOptions = {
        httpOnly?: boolean | undefined;
        secure?: boolean | undefined;
        sameSite?: boolean | 'lax' | 'strict' | 'none' | undefined;
        path?: string | undefined;
        maxAge?: number | undefined;
      };

      let setOptions: CookieOptions | undefined;
      let clearOptions: CookieOptions | undefined;

      const res = makeRes();
      vi.mocked(res.cookie).mockImplementation(
        (_name: string, _val: string, options?: CookieOptions) => {
          setOptions = options;
          return res;
        },
      );
      vi.mocked(res.clearCookie).mockImplementation(
        (_name: string, options?: CookieOptions) => {
          clearOptions = options;
          return res;
        },
      );

      setRefreshTokenCookie(res, 'raw-token-value');
      clearRefreshTokenCookie(res);

      expect(setOptions).toBeDefined();
      expect(clearOptions).toMatchObject({
        httpOnly: setOptions?.httpOnly,
        secure: setOptions?.secure,
        sameSite: setOptions?.sameSite,
        path: setOptions?.path,
      });
    });
  });
});
