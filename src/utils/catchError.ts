import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ParamsDictionary } from 'express-serve-static-core';
import type { ParsedQs } from 'qs';
import * as z from 'zod';
import {
  ForbiddenError,
  BadRequestError,
  NotFoundError,
  UnauthorizedError,
  ConflictError,
  GoneError,
  HasOwnedRoomsError,
} from './checks.js';

export const catchError =
  <
    P = ParamsDictionary,
    ResBody = unknown,
    ReqBody = unknown,
    ReqQuery = ParsedQs,
  >(
    fn: RequestHandler<P, ResBody, ReqBody, ReqQuery>,
  ) =>
  (
    req: Request<P, ResBody, ReqBody, ReqQuery>,
    res: Response<ResBody>,
    next: NextFunction,
  ) => {
    Promise.resolve(fn(req, res, next)).catch((err) => {
      if (err instanceof z.ZodError) {
        (res as Response)
          .status(400)
          .send({ message: 'Validation error', errors: err.issues });
        return;
      }
      if (err instanceof ForbiddenError) {
        (res as Response).status(403).json({ message: err.message });
        return;
      }
      if (err instanceof BadRequestError) {
        (res as Response).status(400).json({ message: err.message });
        return;
      }
      if (err instanceof NotFoundError) {
        (res as Response).status(404).json({ message: err.message });
        return;
      }
      if (err instanceof UnauthorizedError) {
        (res as Response).status(401).json({ message: err.message });
        return;
      }
      if (err instanceof ConflictError) {
        (res as Response).status(409).json({ message: err.message });
        return;
      }
      if (err instanceof GoneError) {
        (res as Response).status(410).json({ message: err.message });
        return;
      }
      // NOTE: HasOwnedRoomsError also maps to 409, same as ConflictError above —
      // but it's a distinct class with its own payload shape ({message, rooms}
      // vs {message}). Keep this as a separate branch: don't fold it into the
      // ConflictError check (e.g. via `err instanceof ConflictError`) even if
      // someone later makes HasOwnedRoomsError extend ConflictError — that
      // would silently drop the `rooms` field from the response.
      if (err instanceof HasOwnedRoomsError) {
        (res as Response).status(409).json({
          message: err.message,
          rooms: err.rooms,
        });
        return;
      }
      next(err);
    });
  };
