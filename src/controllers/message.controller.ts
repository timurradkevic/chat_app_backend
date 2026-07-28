import type { NextFunction, Request, Response } from 'express';
import { messageService } from '../services/message.service.js';
import * as z from 'zod';
import { AuthUserId } from '../utils/auth.js';
import {
  assertIsAuthor,
  assertIsMessage,
  assertIsMessageId,
  assertIsRoom,
  assertIsRoomId,
  assertIsUserInRoom,
} from '../utils/checks.js';

const CreateMessageData = z.object({
  content: z.string(),
  roomId: z.string(),
});

const UpdateMessageData = z.object({
  content: z.string(),
});

export const messageController = {
  async getAllByRoomId(
    req: Request<{ roomId: string }>,
    res: Response,
    next: NextFunction,
  ) {
    const { id } = AuthUserId.parse(req.body); // req.user
    const { roomId } = req.params;

    assertIsRoomId(roomId);

    await assertIsRoom(roomId);

    await assertIsUserInRoom(id, roomId);

    const messages = await messageService.getAllByRoomId(roomId);

    res.send(messages);
  },

  async getOneById(
    req: Request<{ roomId: string; messageId: string }>,
    res: Response,
    next: NextFunction,
  ) {
    const { id } = AuthUserId.parse(req.body);
    const { messageId } = req.params;

    assertIsMessageId(messageId);

    const message = await assertIsMessage(messageId);

    await assertIsUserInRoom(id, message.roomId);

    res.send(message);
  },

  async create(req: Request, res: Response, next: NextFunction) {
    const { id } = AuthUserId.parse(req.body); // req.user
    const { messageData } = req.body;

    const verifiedData = {
      ...CreateMessageData.parse(messageData),
      userId: id,
    };

    await assertIsRoom(verifiedData.roomId);

    await assertIsUserInRoom(verifiedData.userId, verifiedData.roomId);

    const message = await messageService.create(verifiedData);

    res.status(201).send(message);
  },

  async delete(
    req: Request<{ messageId: string }>,
    res: Response,
    next: NextFunction,
  ) {
    const { id } = AuthUserId.parse(req.body); // req.user
    const { messageId } = req.params;

    assertIsMessageId(messageId);

    const message = await assertIsMessage(messageId);

    assertIsAuthor(id, message.userId || '');

    await messageService.delete(messageId);

    res.sendStatus(204);
  },

  async update(
    req: Request<{ messageId: string }>,
    res: Response,
    next: NextFunction,
  ) {
    const { id } = AuthUserId.parse(req.body); // req.user
    const { messageId } = req.params;
    const { messageData } = req.body;

    assertIsMessageId(messageId);

    const message = await assertIsMessage(messageId);

    assertIsAuthor(id, message.userId || '');

    await assertIsUserInRoom(id, message.roomId);

    const verifiedData = {
      ...UpdateMessageData.parse(messageData),
      userId: message.userId,
      roomId: message.roomId,
    };

    const updatedMessage = await messageService.update(messageId, verifiedData);

    res.send(updatedMessage);
  },
};
