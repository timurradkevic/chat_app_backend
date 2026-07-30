import express from 'express';
import { catchError } from '../utils/catchError.js';
import { userController } from '../controllers/user.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import {
  activationEmailRateLimitMiddleware,
  activationIpRateLimitMiddleware,
  loginRateLimitMiddleware,
  registerRateLimitMiddleware,
} from '../middlewares/rateLimit.middleware.js';

export const userRouter = express.Router();

userRouter.post(
  '/register',
  catchError(registerRateLimitMiddleware),
  catchError(userController.register),
);
userRouter.get(
  '/me',
  catchError(authMiddleware),
  catchError(userController.getMe),
);
userRouter.patch(
  '/me',
  catchError(authMiddleware),
  catchError(userController.update),
);
userRouter.patch(
  '/me/password',
  catchError(authMiddleware),
  catchError(userController.updatePassword),
);
userRouter.delete(
  '/me',
  catchError(authMiddleware),
  catchError(userController.delete),
);
userRouter.post(
  '/login',
  catchError(loginRateLimitMiddleware),
  catchError(userController.login),
);
userRouter.post('/google', catchError(userController.loginWithGoogle));
userRouter.get(
  '/activation/:activationToken',
  catchError(userController.activate),
);
userRouter.post(
  '/activation',
  catchError(activationIpRateLimitMiddleware),
  catchError(activationEmailRateLimitMiddleware),
  catchError(userController.resendActivation),
);
