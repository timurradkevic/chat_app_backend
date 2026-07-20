import type { Room } from '../generated/prisma/client.js';
import { Role } from '../generated/prisma/enums.js'
import { prisma } from '../lib/prisma.js';

type RoomData = Omit<Room, 'id' | 'createdAt' | 'updatedAt'>;

export const roomService = {
  async getAll() {
    const rooms = await prisma.room.findMany();

    return rooms;
  },

  async getAllByUserId(userId: string) {
    const rooms = await prisma.room.findMany({ where: { members: { some: { userId }}}});

    return rooms;
  },

  async getAllUserByRoomId(roomId: string) {
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      include: { members: true },
    });

    return room?.members || null;
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
        data: {
          userId: newRoom.ownerId,
          roomId: newRoom.id,
          role: Role.OWNER,
        },
      });

      return newRoom;
    });

    return room;
  },

  async delete(roomId: string) {
    await prisma.room.delete({ where: { id: roomId } });
  },

  async update(roomId: string, roomData: RoomData) {
    const room = await prisma.room.update({
      where: { id: roomId },
      data: roomData,
    });

    return room;
  },

  async addUser(roomId: string, userId: string) {
    await prisma.roomMember.create({ data: { userId, roomId } });

    const updatedRoom = await prisma.room.findUnique({
      where: { id: roomId },
      include: { members: true },
    });

    return updatedRoom;
  },

  async changeMemberRole(userId: string, roomId: string, role: Role) {
    const updatedRoomMember = prisma.roomMember.update({
      where: { userId_roomId: { userId, roomId } },
      data: { role },
    });

    return updatedRoomMember;
  },

  async checkIsUserIn(userId: string, roomId: string): Promise<boolean> {
    const isUserInRoom = await prisma.roomMember.findUnique({
      where: { userId_roomId: { userId, roomId } },
    });

    return isUserInRoom ? true : false;
  },

  async removeUser(roomId: string, userId: string) {
    await prisma.roomMember.delete({
      where: { userId_roomId: { userId, roomId } },
    });

    const updatedRoom = await prisma.room.findUnique({
      where: { id: roomId },
      include: { members: true },
    });

    return updatedRoom;
  },

  async transferOwnership(roomId: string, fromUserId: string, toUserId: string) {
    const updatedOwner = await prisma.$transaction(async (tx) => {
      const updatedRoomOwner = await tx.roomMember.update({ where: { userId_roomId: { userId: toUserId, roomId } }, data: { role: Role.OWNER } });
      await tx.roomMember.update({ where: { userId_roomId: { userId: fromUserId, roomId } }, data: { role: Role.ADMIN } });

      return updatedRoomOwner;
    });

    return updatedOwner;
  },
};
