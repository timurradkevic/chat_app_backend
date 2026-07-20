import type { Message } from '../generated/prisma/client.js';
import { prisma } from '../lib/prisma.js';

type MessageData = Omit<Message, 'id' | 'createdAt' | 'updatedAt'>;

export const messageService = {
  async getAllByRoomId(roomId: string) {
    const messages = await prisma.message.findMany({ where: { roomId } });

    return messages;
  },

  async getOneById(messageId: string) {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
    });

    return message;
  },

  async create(messageData: MessageData) {
    const message = await prisma.message.create({ data: messageData });

    return message;
  },

  async delete(messageId: string) {
    await prisma.message.delete({ where: { id: messageId } });
  },

  async update(messageId: string, messageData: MessageData) {
    const message = await prisma.message.update({
      where: { id: messageId },
      data: messageData,
    });

    return message;
  },
};
