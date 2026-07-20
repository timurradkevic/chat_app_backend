import type { NextFunction, Request, Response } from 'express';

export const errorMiddleware = (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (res.headersSent) {
    return next(error);
  }

  console.error(error);

  return res.status(500).json({
    message: 'Server error',
  });
};
