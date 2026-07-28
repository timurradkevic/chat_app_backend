import express from 'express';
import { catchError } from '../utils/catchError.js';
import { userController } from '../controllers/user.controller.js';

export const userRouter = express.Router();

userRouter.post('/register', catchError(userController.register));
userRouter.get('/me', catchError(userController.getMe));
userRouter.patch('/me', catchError(userController.update));
userRouter.patch('/me/password', catchError(userController.updatePassword));
userRouter.delete('/me', catchError(userController.delete));
userRouter.post('/login', catchError(userController.login));
userRouter.post('/google', catchError(userController.loginWithGoogle));
userRouter.get('/activation/:activationToken', catchError(userController.activate));
userRouter.post('/activation', catchError(userController.resendActivation));
