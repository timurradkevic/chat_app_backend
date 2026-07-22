import type { User } from '../generated/prisma/client.js';
import { prisma } from '../lib/prisma.js';
import bcrypt from 'bcrypt';

type UserData = Pick<User, 'name' | 'email' | 'password'>;
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

  async create(userData: UserData) {
    const hashPass = await bcrypt.hash(userData.password, 10);
    const user = await prisma.user.create({ data: { email: userData.email, name: userData.name, password: hashPass } });

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

  async delete(userId: string) {
    await prisma.user.delete({ where: { id: userId } });
  },

  async verifyPassword(user: User, plainPassword: string) {
    const isValidPassword = await bcrypt.compare(plainPassword, user.password)

    return isValidPassword;
  },
};
