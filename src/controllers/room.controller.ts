import type { Request, Response, NextFunction } from 'express';
import * as z from 'zod';
import { roomService } from '../services/room.service.js';
import { Role } from '../generated/prisma/enums.js';
import {
  assertHasHigherRole,
  assertIsAdminOrOwner,
  assertIsDifferentUser,
  assertIsOwner,
  assertIsOwnerTryingToLeave,
  assertIsRoom,
  assertIsRoomId,
  assertIsUser,
  assertIsUserId,
  assertIsUserInRoom,
  assertIsUserIsNotInRoom,
} from '../utils/checks.js';

const RoomData = z.object({
  name: z.string(),
});

const UpdatedRoomData = z.object({
  name: z.string(),
});

const AddUserBody = z.object({
  userId: z.string(),
});

const changeMemberRoleBody = z.object({
  role: z.enum(Role),
});

export const roomController = {
  async getAll(req: Request, res: Response, next: NextFunction) {
    // NOTE: this intentionally returns every room in the system (a public
    // directory), not just the caller's rooms — see `getAllByUserId` (/mine)
    // for that
    const rooms = await roomService.getAll();

    res.status(200).send(rooms);
  },

  async getAllByUserId(req: Request, res: Response, next: NextFunction) {
    const { id } = req.user;

    const rooms = await roomService.getAllByUserId(id);

    res.status(200).send(rooms);
  },

  async getAllUserByRoomId(
    req: Request<{ roomId: string }>,
    res: Response,
    next: NextFunction,
  ) {
    const { id } = req.user;
    const { roomId } = req.params;

    assertIsRoomId(roomId);

    await assertIsRoom(roomId);

    await assertIsUserInRoom(id, roomId);

    const users = await roomService.getAllUserByRoomId(roomId);

    res.status(200).send(users);
  },

  async create(req: Request, res: Response, next: NextFunction) {
    const { id } = req.user;
    const { roomData } = req.body;

    const verifiedData = RoomData.parse(roomData);

    const room = await roomService.create({ ...verifiedData, ownerId: id });

    res.status(201).send(room);
  },

  async delete(
    req: Request<{ roomId: string }>,
    res: Response,
    next: NextFunction,
  ) {
    const { id } = req.user;
    const { roomId } = req.params;

    assertIsRoomId(roomId);

    await assertIsRoom(roomId);

    await assertIsOwner(id, roomId);

    await roomService.delete(roomId);

    res.sendStatus(204);
  },

  async update(
    req: Request<{ roomId: string }>,
    res: Response,
    next: NextFunction,
  ) {
    const { id } = req.user;
    const { roomId } = req.params;
    const { roomData } = req.body;

    assertIsRoomId(roomId);

    const room = await assertIsRoom(roomId);

    await assertIsAdminOrOwner(id, roomId);

    const verifiedData = {
      ...UpdatedRoomData.parse(roomData),
      ownerId: room.ownerId,
    };

    const updatedRoom = await roomService.update(roomId, verifiedData);

    res.status(200).send(updatedRoom);
  },

  async addUser(
    req: Request<{ roomId: string }>,
    res: Response,
    next: NextFunction,
  ) {
    const { id } = req.user;
    const { userId } = AddUserBody.parse(req.body);
    const { roomId } = req.params;

    assertIsRoomId(roomId);

    await assertIsAdminOrOwner(id, roomId);

    await assertIsRoom(roomId);

    await assertIsUser(userId);

    await assertIsUserIsNotInRoom(userId, roomId);

    const roomMember = await roomService.addUser(roomId, userId);

    res.status(200).send(roomMember);
  },

  async removeUser(
    req: Request<{ roomId: string; userId: string }>,
    res: Response,
    next: NextFunction,
  ) {
    const { id } = req.user;
    const { roomId, userId } = req.params;

    assertIsRoomId(roomId);

    assertIsUserId(userId);

    await assertIsUser(userId);

    await assertIsRoom(roomId);

    await assertIsUserInRoom(userId, roomId);

    await assertHasHigherRole(id, userId, roomId);

    await roomService.removeUser(roomId, userId);

    res.sendStatus(204);
  },

  async leave(
    req: Request<{ roomId: string }>,
    res: Response,
    next: NextFunction,
  ) {
    const { id } = req.user;
    const { roomId } = req.params;

    assertIsRoomId(roomId);

    await assertIsUser(id);

    await assertIsRoom(roomId);

    await assertIsUserInRoom(id, roomId);

    await assertIsOwnerTryingToLeave(id, roomId);

    await roomService.removeUser(roomId, id);

    res.sendStatus(204);
  },

  async changeMemberRole(
    req: Request<{ roomId: string; userId: string }>,
    res: Response,
    next: NextFunction,
  ) {
    const { id } = req.user;
    const { roomId, userId } = req.params;
    const { role } = changeMemberRoleBody.parse(req.body);

    assertIsRoomId(roomId);

    assertIsUserId(userId);

    await assertIsUser(userId);

    await assertIsRoom(roomId);

    await assertIsUserInRoom(userId, roomId);

    await assertHasHigherRole(id, userId, roomId, role);

    const updatedMember = await roomService.changeMemberRole(
      userId,
      roomId,
      role,
    );

    res.send(updatedMember);
  },
  async transferOwnership(
    req: Request<{ roomId: string; userId: string }>,
    res: Response,
    next: NextFunction,
  ) {
    const { id } = req.user;
    const { roomId, userId } = req.params;

    assertIsRoomId(roomId);

    assertIsUserId(userId);

    await assertIsUser(userId);

    await assertIsRoom(roomId);

    await assertIsUserInRoom(userId, roomId);

    await assertIsOwner(id, roomId);

    assertIsDifferentUser(id, userId);

    const updatedMember = await roomService.transferOwnership(
      roomId,
      id,
      userId,
    );

    res.send(updatedMember);
  },
};
