import type { User } from '../generated/prisma/client.js';
import { prisma } from '../lib/prisma.js';
import bcrypt from 'bcrypt';

type UserData = Pick<User, 'name' | 'email' | 'password'>;
type UserGoogleData = Pick<User, 'name' | 'email' | 'googleId'>;
type UpdatedUserData = Pick<User, 'name' | 'email'>;

export const userService = {
  async getOneById(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });

    return user;
  },

  async getOneByEmail(userEmail: string) {
    const user = await prisma.user.findUnique({ where: { email: userEmail } });

    return user;
  },

  async getOneByGoogleId(userGoogleId: string) {
    const user = await prisma.user.findUnique({
      where: { googleId: userGoogleId },
    });

    return user;
  },

  async create(userData: UserData) {
    const hashPass = userData.password
      ? await bcrypt.hash(userData.password, 10)
      : null;
    const user = await prisma.user.create({
      data: { email: userData.email, name: userData.name, password: hashPass },
    });

    return user;
  },

  async createFromGoogle(userGoogleData: UserGoogleData) {
    const user = await prisma.user.create({
      data: {
        email: userGoogleData.email,
        name: userGoogleData.name,
        password: null,
        googleId: userGoogleData.googleId,
        confirmedEmail: true,
      },
    });

    return user;
  },

  async update(userId: string, userData: UpdatedUserData) {
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: userData,
    });

    return updatedUser;
  },

  async updatePassword(userId: string, newPassword: string) {
    const hashPass = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: userId },
      data: { password: hashPass },
    });
  },

  async linkGoogleId(userId: string, googleId: string) {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { confirmedEmail: true, googleId },
      });

      await tx.token.deleteMany({ where: { userId, type: 'ACTIVATION' } });
    });
  },

  async delete(userId: string) {
    await prisma.user.delete({ where: { id: userId } });
  },

  async verifyPassword(user: User, plainPassword: string) {
    const isValidPassword = await bcrypt.compare(
      plainPassword,
      user?.password ?? '',
    );

    return isValidPassword;
  },

  async confirmEmail(userId: string, tokenId: string) {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { confirmedEmail: true },
      });

      await tx.token.delete({ where: { id: tokenId } });
    });
  },
};
