import type { Room } from '../generated/prisma/client.js';
import { Role } from '../generated/prisma/enums.js'
import { prisma } from '../lib/prisma.js';

type RoomData = Omit<Room, 'id' | 'createdAt' | 'updatedAt'>;

export const roomService = {
  async getAll() {
    const rooms = await prisma.room.findMany();
    return rooms;
  },

  async getOneById(roomId: string) {
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    return room;
  },

  async getMemberRole(userId: string, roomId: string) {
    const roomMember = await prisma.roomMember.findUnique({
      where: { userId_roomId: { userId, roomId } },
    });
    return roomMember?.role || null;
  },

  async create(roomData: RoomData) {
    const room = await prisma.$transaction(async (tx) => {
      const newRoom = await tx.room.create({ data: roomData });
      await tx.roomMember.create({
        data: { userId: newRoom.ownerId, roomId: newRoom.id, role: Role.OWNER },
      });
      return newRoom;
    });
    return room;
  },

  async delete(roomId: string) {
    await prisma.room.delete({ where: { id: roomId } });
  },

  async update(roomId: string, roomData: RoomData) {
    const room = await prisma.room.update({ where: { id: roomId }, data: roomData });
    return room;
  },
};
