import type { Request, Response, NextFunction } from 'express';
import * as z from 'zod';
import { userService } from '../services/user.service.js';
import {
  assertHasNoOwnedRooms,
  assertIsCorrectEmailAndPassword,
  assertIsCorrectPassword,
  assertIsUniqueEmail,
  assertIsUser,
  assertIsValidToken,
  assertIsConfirmedEmail,
  assertIsValidGoogleToken,
  assertIsEmailVerified,
} from '../utils/checks.js';
import type { User } from '../generated/prisma/client.js';
import { jwtService } from '../utils/jwt.js';
import { tokenService } from '../services/token.service.js';
import { mailer } from '../utils/email.js';
import { refreshTokenService } from '../services/refreshToken.service.js';

const stabilizeUser = (user: User) => {
  const { password, ...userWithoutPass } = user;

  return userWithoutPass;
};

const PasswordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[0-9]/, 'Password must contain a digit');

const RegisterData = z.object({
  email: z.email(),
  name: z
    .string()
    .min(2, 'Name cannot be empty')
    .max(100, 'Name cannot exceed 100 characters'),
  password: PasswordSchema,
});

const UpdatedUserData = z.object({
  name: z
    .string()
    .min(2, 'Name cannot be empty')
    .max(100, 'Name cannot exceed 100 characters'),
  email: z.email(),
});

const PasswordData = z.object({
  currentPassword: PasswordSchema,
  newPassword: PasswordSchema,
});

const LoginData = z.object({
  email: z.email(),
  password: z.string(),
});

const GoogleLoginData = z.object({
  idToken: z.string(),
});

const GoogleTokenData = z.object({
  email: z.email(),
  sub: z.string(),
  name: z.string(),
  email_verified: z.boolean(),
});

const ResendActivationData = z.object({
  email: z.email(),
});

const RequestPasswordResetData = z.object({
  email: z.email(),
});

const ConfirmPasswordResetData = z.object({
  newPassword: PasswordSchema,
});

export const userController = {
  async register(req: Request, res: Response, next: NextFunction) {
    const { registerData } = req.body;
    const verifiedData = RegisterData.parse(registerData);

    await assertIsUniqueEmail(verifiedData.email);

    const user = await userService.create(verifiedData);
    const rawToken = await tokenService.create({
      userId: user.id,
      type: 'ACTIVATION',
    });

    await mailer.sendActivationEmail(user.email, rawToken);

    res.status(201).send(stabilizeUser(user));
  },

  async getMe(req: Request, res: Response, next: NextFunction) {
    const { id } = req.user;

    const user = await assertIsUser(id);

    res.status(200).send(stabilizeUser(user));
  },

  async update(req: Request, res: Response, next: NextFunction) {
    const { id } = req.user;
    const { userData } = req.body;
    const verifiedData = UpdatedUserData.parse(userData);

    const currentUser = await assertIsUser(id);

    const isEmailChanged = verifiedData.email !== currentUser.email;

    if (isEmailChanged) {
      await assertIsUniqueEmail(verifiedData.email);
    }

    const user = await userService.update(id, {
      ...verifiedData,
      ...(isEmailChanged ? { confirmedEmail: false } : {}),
    });

    if (isEmailChanged) {
      const rawToken = await tokenService.reissue({
        userId: user.id,
        type: 'ACTIVATION',
      });
      await mailer.sendActivationEmail(user.email, rawToken);
    }

    res.status(200).send(stabilizeUser(user));
  },

  async updatePassword(req: Request, res: Response, next: NextFunction) {
    const { id } = req.user;
    const { passwordData } = req.body;
    const verifiedData = PasswordData.parse(passwordData);

    const user = await assertIsUser(id);

    await assertIsCorrectPassword(user, verifiedData.currentPassword);
    await userService.updatePassword(id, verifiedData.newPassword);

    res.sendStatus(204);
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    const { id } = req.user;

    await assertIsUser(id);

    await assertHasNoOwnedRooms(id);

    await userService.delete(id);

    res.sendStatus(204);
  },

  async login(req: Request, res: Response, next: NextFunction) {
    const { loginData } = req.body;
    const verifiedData = LoginData.parse(loginData);

    const user = await assertIsCorrectEmailAndPassword(
      verifiedData.email,
      verifiedData.password,
    );

    assertIsConfirmedEmail(user);

    const token = jwtService.sign({ userId: user.id, tokenVersion: user.tokenVersion });

    const metadata = {
      ...(req.headers['user-agent'] && {
        userAgent: req.headers['user-agent'],
      }),
      ...(req.ip && {
        ipAddress: req.ip,
      }),
    };

    const refreshToken = await refreshTokenService.create(user.id, metadata);

    res.status(200).send({ accessToken: token, refreshToken });
  },

  async loginWithGoogle(req: Request, res: Response, next: NextFunction) {
    const { googleLoginData } = req.body;
    const verifiedData = GoogleLoginData.parse(googleLoginData);

    const googleTokenData = await assertIsValidGoogleToken(
      verifiedData.idToken,
    );

    const { email, sub, name, email_verified } =
      GoogleTokenData.parse(googleTokenData);

    assertIsEmailVerified(email_verified);

    const userByGoogleId = await userService.getOneByGoogleId(sub);

    if (userByGoogleId) {
      const token = jwtService.sign({ userId: userByGoogleId.id, tokenVersion: userByGoogleId.tokenVersion });

      const metadata = {
        ...(req.headers['user-agent'] && {
          userAgent: req.headers['user-agent'],
        }),
        ...(req.ip && {
          ipAddress: req.ip,
        }),
      };

      const refreshToken = await refreshTokenService.create(userByGoogleId.id, metadata);

      res.status(200).send({ accessToken: token, refreshToken });
    } else {
      const userByEmail = await userService.getOneByEmail(email);

      if (userByEmail) {
        // Auto-linking Google account by verified email — Google's email_verified already proves ownership, so this is safe
        await userService.linkGoogleId(userByEmail.id, sub);

        const token = jwtService.sign({ userId: userByEmail.id, tokenVersion: userByEmail.tokenVersion });

        const metadata = {
          ...(req.headers['user-agent'] && {
            userAgent: req.headers['user-agent'],
          }),
          ...(req.ip && {
            ipAddress: req.ip,
          }),
        };

        const refreshToken = await refreshTokenService.create(userByEmail.id, metadata);

        res.status(200).send({ accessToken: token, refreshToken });
      } else {
        const userData = { name, email, googleId: sub };
        const createdUser = await userService.createFromGoogle(userData);

        const token = jwtService.sign({ userId: createdUser.id, tokenVersion: createdUser.tokenVersion });

        const metadata = {
          ...(req.headers['user-agent'] && {
            userAgent: req.headers['user-agent'],
          }),
          ...(req.ip && {
            ipAddress: req.ip,
          }),
        };

        const refreshToken = await refreshTokenService.create(createdUser.id, metadata);

        res.status(200).send({ accessToken: token, refreshToken });
      }
    }
  },

  async activate(
    req: Request<{ activationToken: string }>,
    res: Response,
    next: NextFunction,
  ) {
    const { activationToken } = req.params;
    const tokenRecord = await assertIsValidToken(activationToken, 'ACTIVATION');

    await userService.confirmEmail(tokenRecord.userId, tokenRecord.id);

    res.sendStatus(204);
  },

  async resendActivation(req: Request, res: Response, next: NextFunction) {
    const { resendActivationData } = req.body;
    const verifiedData = ResendActivationData.parse(resendActivationData);

    const user = await userService.getOneByEmail(verifiedData.email);

    if (user && user.confirmedEmail === false) {
      const rawToken = await tokenService.reissue({
        type: 'ACTIVATION',
        userId: user.id,
      });

      await mailer.sendActivationEmail(user.email, rawToken);
    }

    res.sendStatus(204);
  },

  async requestPasswordReset(req: Request, res: Response, next: NextFunction) {
    const { resetPasswordData } = req.body;
    const verifiedData = RequestPasswordResetData.parse(resetPasswordData);

    const user = await userService.getOneByEmail(verifiedData.email);

    // Always respond 204 regardless of whether the email exists, so this
    // endpoint can't be used to enumerate registered accounts.
    if (user) {
      const rawToken = await tokenService.reissue({
        type: 'RESET',
        userId: user.id,
      });

      await mailer.sendResetPasswordEmail(user.email, rawToken);
    }

    res.sendStatus(204);
  },

  async confirmPasswordReset(
    req: Request<{ resetToken: string }>,
    res: Response,
    next: NextFunction,
  ) {
    const { resetToken } = req.params;
    const { resetPasswordData } = req.body;
    const verifiedData = ConfirmPasswordResetData.parse(resetPasswordData);

    const tokenRecord = await assertIsValidToken(resetToken, 'RESET');

    await userService.updatePassword(
      tokenRecord.userId,
      verifiedData.newPassword,
    );
    await tokenService.invalidate(tokenRecord.id);

    res.sendStatus(204);
  },
};
