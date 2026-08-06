import { describe, it, expect, vi, beforeEach } from 'vitest';
import { roomService } from './room.service.js';
import { prisma } from '../lib/prisma.js';
import { Role } from '../generated/prisma/enums.js';
import type { Room, RoomMember } from '../generated/prisma/client.js';

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    room: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    roomMember: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

type TransactionClient = Parameters<typeof prisma.$transaction>[0] extends (
  tx: infer T,
) => unknown
  ? T
  : never;

function makeRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: 'room-1',
    name: 'Room',
    ownerId: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    lastActivityAt: new Date(),
    ...overrides,
  };
}

// Mimics what Prisma actually returns for `select: { ..., _count: { select: { members: true } } }`
function makeRoomWithCount(overrides: Partial<Room> = {}, membersCount = 3) {
  return {
    ...makeRoom(overrides),
    _count: { members: membersCount },
  };
}

function makeRoomMember(overrides: Partial<RoomMember> = {}): RoomMember {
  return {
    id: 'member-1',
    userId: 'user-1',
    roomId: 'room-1',
    role: Role.MEMBER,
    joinedAt: new Date(),
    ...overrides,
  };
}

describe('roomService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getAll', () => {
    it('maps _count.members to memberCount and strips the raw _count field', async () => {
      const roomsFromDb = [
        makeRoomWithCount({ id: 'room-1' }, 5),
        makeRoomWithCount({ id: 'room-2' }, 0),
      ];
      vi.mocked(prisma.room.findMany).mockResolvedValue(
        roomsFromDb as unknown as Room[],
      );
      vi.mocked(prisma.room.count).mockResolvedValue(2);

      const result = await roomService.getAll(1, 20);

      expect(result.data).toEqual([
        expect.objectContaining({ id: 'room-1', memberCount: 5 }),
        expect.objectContaining({ id: 'room-2', memberCount: 0 }),
      ]);
      result.data.forEach((room) => {
        expect(room).not.toHaveProperty('_count');
      });
    });

    it('requests the member count from Prisma via _count.select.members', async () => {
      vi.mocked(prisma.room.findMany).mockResolvedValue([]);
      vi.mocked(prisma.room.count).mockResolvedValue(0);

      await roomService.getAll(1, 20);

      expect(prisma.room.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            _count: { select: { members: true } },
          }),
        }),
      );
    });
  });

  describe('getAllByUserId', () => {
    it('maps _count.members to memberCount and strips the raw _count field', async () => {
      const roomsFromDb = [makeRoomWithCount({ id: 'room-1' }, 7)];
      vi.mocked(prisma.room.findMany).mockResolvedValue(
        roomsFromDb as unknown as Room[],
      );

      const result = await roomService.getAllByUserId('user-1');

      expect(result.data).toEqual([
        expect.objectContaining({ id: 'room-1', memberCount: 7 }),
      ]);
      result.data.forEach((room) => {
        expect(room).not.toHaveProperty('_count');
      });
    });

    it('requests the member count from Prisma via _count.select.members', async () => {
      vi.mocked(prisma.room.findMany).mockResolvedValue([]);

      await roomService.getAllByUserId('user-1');

      expect(prisma.room.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            _count: { select: { members: true } },
          }),
        }),
      );
    });
  });

  describe('checkIsUserIn', () => {
    it('returns true when a membership record exists', async () => {
      vi.mocked(prisma.roomMember.findUnique).mockResolvedValue(
        makeRoomMember(),
      );

      expect(await roomService.checkIsUserIn('user-1', 'room-1')).toBe(true);
    });

    it('returns false when no membership record exists', async () => {
      vi.mocked(prisma.roomMember.findUnique).mockResolvedValue(null);

      expect(await roomService.checkIsUserIn('user-1', 'room-1')).toBe(false);
    });
  });

  describe('hasOwnedRoom', () => {
    it('returns true and the list of owned rooms (id, name only) when the user owns at least one room', async () => {
      const ownedRooms = [{ id: 'room-1', name: 'Room' }];
      vi.mocked(prisma.room.findMany).mockResolvedValue(
        ownedRooms as unknown as Room[],
      );

      expect(await roomService.hasOwnedRoom('user-1')).toEqual({
        hasOwnedRooms: true,
        rooms: ownedRooms,
      });
    });

    it('returns false and an empty list when the user owns no rooms', async () => {
      vi.mocked(prisma.room.findMany).mockResolvedValue([]);

      expect(await roomService.hasOwnedRoom('user-1')).toEqual({
        hasOwnedRooms: false,
        rooms: [],
      });
    });

    it('requests only id and name from Prisma, not the full room record', async () => {
      vi.mocked(prisma.room.findMany).mockResolvedValue([]);

      await roomService.hasOwnedRoom('user-1');

      expect(prisma.room.findMany).toHaveBeenCalledWith({
        where: { ownerId: 'user-1' },
        select: { id: true, name: true },
      });
    });

    it('uses the passed transaction client instead of the default prisma client when provided', async () => {
      const txFindMany = vi.fn().mockResolvedValue([]);
      const tx = { room: { findMany: txFindMany } } as unknown as Parameters<
        typeof roomService.hasOwnedRoom
      >[1];

      await roomService.hasOwnedRoom('user-1', tx);

      expect(txFindMany).toHaveBeenCalledWith({
        where: { ownerId: 'user-1' },
        select: { id: true, name: true },
      });
      expect(prisma.room.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getMemberRole', () => {
    it('returns the role when the user is a member of the room', async () => {
      vi.mocked(prisma.roomMember.findUnique).mockResolvedValue(
        makeRoomMember({ role: Role.ADMIN }),
      );

      expect(await roomService.getMemberRole('user-1', 'room-1')).toBe(
        Role.ADMIN,
      );
    });

    it('returns null when the user is not a member of the room', async () => {
      vi.mocked(prisma.roomMember.findUnique).mockResolvedValue(null);

      expect(await roomService.getMemberRole('user-1', 'room-1')).toBeNull();
    });
  });

  describe('create', () => {
    it('creates the room and adds the owner as a member with role OWNER, in one transaction', async () => {
      const createdRoom = makeRoom();
      const tx = {
        room: {
          create: vi
            .fn<TransactionClient['room']['create']>()
            .mockResolvedValue(createdRoom),
        },
        roomMember: {
          create: vi
            .fn<TransactionClient['roomMember']['create']>()
            .mockResolvedValue(makeRoomMember({ role: Role.OWNER })),
        },
      };

      vi.mocked(prisma.$transaction).mockImplementation(async (cb) =>
        cb(tx as unknown as TransactionClient),
      );

      const room = await roomService.create({
        name: 'Room',
        ownerId: 'user-1',
      });

      expect(room).toEqual(createdRoom);
      expect(tx.roomMember.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', roomId: 'room-1', role: Role.OWNER },
      });
    });
  });

  describe('transferOwnership', () => {
    it('promotes the new owner to OWNER and demotes the previous owner to ADMIN', async () => {
      const tx = {
        room: {
          update: vi
            .fn<TransactionClient['room']['update']>()
            .mockResolvedValue(makeRoom({ ownerId: 'new-owner' })),
        },
        roomMember: {
          update: vi
            .fn<TransactionClient['roomMember']['update']>()
            .mockResolvedValue(makeRoomMember({ role: Role.OWNER })),
        },
      };

      vi.mocked(prisma.$transaction).mockImplementation(async (cb) =>
        cb(tx as unknown as TransactionClient),
      );

      await roomService.transferOwnership('room-1', 'old-owner', 'new-owner');

      expect(tx.roomMember.update).toHaveBeenNthCalledWith(1, {
        where: { userId_roomId: { userId: 'new-owner', roomId: 'room-1' } },
        data: { role: Role.OWNER },
      });
      expect(tx.roomMember.update).toHaveBeenNthCalledWith(2, {
        where: { userId_roomId: { userId: 'old-owner', roomId: 'room-1' } },
        data: { role: Role.ADMIN },
      });
    });

    it('updates the room ownerId to the new owner', async () => {
      const tx = {
        room: {
          update: vi
            .fn<TransactionClient['room']['update']>()
            .mockResolvedValue(makeRoom({ ownerId: 'new-owner' })),
        },
        roomMember: {
          update: vi
            .fn<TransactionClient['roomMember']['update']>()
            .mockResolvedValue(makeRoomMember({ role: Role.OWNER })),
        },
      };

      vi.mocked(prisma.$transaction).mockImplementation(async (cb) =>
        cb(tx as unknown as TransactionClient),
      );

      await roomService.transferOwnership('room-1', 'old-owner', 'new-owner');

      expect(tx.room.update).toHaveBeenCalledWith({
        where: { id: 'room-1' },
        data: { ownerId: 'new-owner' },
      });
    });
  });
});
