import type { Request, Response, NextFunction } from 'express';
import * as z from 'zod';
import { userService } from '../services/user.service.js';
import { assertIsCorrectPassword, assertIsUniqueEmail, assertIsUser } from '../utils/checks.js';
import { AuthUserId } from '../utils/auth.js';
import type { User } from '../generated/prisma/client.js';

const stabilizeUser = (user: User) => {
  const { password, ...userWithoutPass } = user;

  return userWithoutPass;
}

const PasswordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[0-9]/, 'Password must contain a digit');

const RegisterData = z.object({
  email: z.email(),
  name: z.string(),
  password: PasswordSchema
});

const UpdatedUserData = z.object({
  name: z.string(),
  email: z.email(),
});

const PasswordData = z.object({
  currentPassword: PasswordSchema,
  newPassword: PasswordSchema,
});

export const userController = {
  async register(req: Request, res: Response, next: NextFunction) {
    const { registerData } = req.body;
    const verifiedData = RegisterData.parse(registerData);

    await assertIsUniqueEmail(verifiedData.email);

    const user = await userService.create(verifiedData);

    res.status(201).send(stabilizeUser(user));
  },

  async getMe(req: Request, res: Response, next: NextFunction) {
    const { id } = AuthUserId.parse(req.body);

    const user = await assertIsUser(id);

    res.status(200).send(stabilizeUser(user));
  },

  async update(req: Request, res: Response, next: NextFunction) {
    const { id } = AuthUserId.parse(req.body);
    const { userData } = req.body;
    const verifiedData = UpdatedUserData.parse(userData);

    await assertIsUser(id);

    const user = await userService.update(id, verifiedData);

    res.status(200).send(stabilizeUser(user));
  },

  async updatePassword(req: Request, res: Response, next: NextFunction) {
    const { id } = AuthUserId.parse(req.body);
    const { passwordData } = req.body;
    const verifiedData = PasswordData.parse(passwordData);

    await assertIsUser(id);

    await assertIsCorrectPassword(id, verifiedData.currentPassword);
    await userService.updatePassword(id, verifiedData.newPassword);

    res.sendStatus(204);
  },
};
