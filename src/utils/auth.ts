import * as z from 'zod';

/**
 * Temporary stand-in for real authentication.
 * Until auth middleware exists, the caller's id is passed explicitly in the
 * request body and trusted as-is. Replace with req.user once auth is added.
 */
export const AuthUserId = z.object({ id: z.string() });
