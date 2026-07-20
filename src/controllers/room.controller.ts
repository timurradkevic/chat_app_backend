import type { Request, Response, NextFunction } from 'express';
import * as z from 'zod';
import { roomService } from '../services/room.service.js';
import { AuthUserId } from '../utils/auth.js';
import { assertIsAdminOrOwner, assertIsOwner, assertIsRoom, assertIsRoomId } from '../utils/checks.js';

const RoomData = z.object({
  name: z.string(),
  ownerId: z.string(),
});

const UpdatedRoomData = z.object({
  name: z.string(),
});

export const roomController = {
  async getAll(req: Request, res: Response, next: NextFunction) {
    const rooms = await roomService.getAll();
    res.status(200).send(rooms);
  },

  async create(req: Request, res: Response, next: NextFunction) {
    const { roomData } = req.body;
    const verifiedData = RoomData.parse(roomData);
    const room = await roomService.create(verifiedData);
    res.status(201).send(room);
  },

  async delete(req: Request<{ roomId: string }>, res: Response, next: NextFunction) {
    const { id } = AuthUserId.parse(req.body); // req.user
    const { roomId } = req.params;

    assertIsRoomId(roomId);
    await assertIsRoom(roomId);
    await assertIsOwner(id, roomId);

    await roomService.delete(roomId);
    res.sendStatus(204);
  },

  async update(req: Request<{ roomId: string }>, res: Response, next: NextFunction) {
    const { id } = AuthUserId.parse(req.body); // req.user
    const { roomId } = req.params;
    const { roomData } = req.body;

    assertIsRoomId(roomId);
    const room = await assertIsRoom(roomId);
    await assertIsAdminOrOwner(id, roomId);

    const verifiedData = { ...UpdatedRoomData.parse(roomData), ownerId: room.ownerId };
    const updatedRoom = await roomService.update(roomId, verifiedData);
    res.status(200).send(updatedRoom);
  },
};
