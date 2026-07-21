import express from 'express';
import { catchError } from '../utils/catchError.js';
import { userController } from '../controllers/user.controller.js';

export const userRouter = express.Router();

userRouter.post('/register', catchError(userController.register));
userRouter.get('/me', catchError(userController.getMe));
userRouter.patch('/me', catchError(userController.update));
