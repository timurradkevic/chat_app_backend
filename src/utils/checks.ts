import { roomService } from '../services/room.service.js';

export class ForbiddenError extends Error {
  constructor(message = 'Forbidden') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export class BadRequestError extends Error {
  constructor(message = 'Bad Request') {
    super(message);
    this.name = 'BadRequest';
  }
}

export class NotFoundError extends Error {
  constructor(message = 'Not Found') {
    super(message);
    this.name = 'NotFound';
  }
}

export async function assertIsOwner(userId: string, roomId: string): Promise<void> {
  const role = await roomService.getMemberRole(userId, roomId);
  if (role !== 'OWNER') {
    throw new ForbiddenError();
  }
}

export async function assertIsAdminOrOwner(userId: string, roomId: string): Promise<void> {
  const role = await roomService.getMemberRole(userId, roomId);
  if (role !== 'ADMIN' && role !== 'OWNER') {
    throw new ForbiddenError();
  }
}

export async function assertIsRoom(roomId: string) {
  const room = await roomService.getOneById(roomId);
  if (!room) {
    throw new NotFoundError();
  }

  return room;
}

export function assertIsRoomId(roomId: string): void {
  if (!roomId) {
    throw new BadRequestError();
  }
}
