import type { Role } from "../generated/prisma/enums.js";
import { roomService } from "../services/room.service.js";
import { prisma } from '../lib/prisma.js';

export class ForbiddenError extends Error {
  constructor(message = 'Forbidden') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export class ConflictError extends Error {
  constructor(message = 'Conflict') {
    super(message);
    this.name = 'ConflictError';
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

export async function assertIsOwnerTryingToLeave(userId: string, roomId: string): Promise<void> {
  const role = await roomService.getMemberRole(userId, roomId);
  if (role === 'OWNER') {
    throw new ConflictError();
  }
}

export async function assertIsAdminOrOwner(userId: string, roomId: string): Promise<void> {
  const role = await roomService.getMemberRole(userId, roomId);
  if (role !== 'ADMIN' && role !== 'OWNER') {
    throw new ForbiddenError();
  }
}

export async function assertHasHigherRole(actorId: string, targetId: string, roomId: string, newRole?: Role): Promise<void> {
  const targetRole = await roomService.getMemberRole(targetId, roomId);
  const actorRole = await roomService.getMemberRole(actorId, roomId);

  if (actorRole !== 'ADMIN' && actorRole !== 'OWNER') {
    throw new ForbiddenError();
  }

  if (targetRole === 'OWNER') {
    throw new ForbiddenError();
  }

  if (targetRole === 'ADMIN' && actorRole !== 'OWNER') {
    throw new ForbiddenError();
  }

  if (actorRole !== 'OWNER' && (newRole === 'ADMIN' || newRole === 'OWNER')) {
    throw new ForbiddenError();
  }
}

export async function assertIsUserInRoom(userId: string, roomId: string): Promise<void> {
  const isUserInRoom = await roomService.checkIsUserIn(userId, roomId);
  if (!isUserInRoom) {
    throw new ForbiddenError();
  }
}

export async function assertIsUserIsNotInRoom(userId: string, roomId: string): Promise<void> {
  const isUserInRoom = await roomService.checkIsUserIn(userId, roomId);
  if (isUserInRoom) {
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

// TODO: replace with a proper userService.getOne() once the user feature lands
export async function assertIsUser(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new NotFoundError();
  }

  return user;
}

export function assertIsRoomId(roomId: string): void {
  if (!roomId) {
    throw new BadRequestError();
  }
}

export function assertIsUserId(userId: string): void {
  if (!userId) {
    throw new BadRequestError();
  }
}

export function assertIsDifferentUser(userId1: string, userId2: string) {
  if (userId1 === userId2) {
    throw new BadRequestError();
  }
}
