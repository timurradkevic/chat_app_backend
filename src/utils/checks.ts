import type { Role, TokenTypes } from "../generated/prisma/enums.js";
import { messageService } from "../services/message.service.js";
import { roomService } from "../services/room.service.js";
import { userService } from "../services/user.service.js";
import type { User } from "../generated/prisma/client.js";
import { tokenService } from "../services/token.service.js";

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
    this.name = 'BadRequestError';
  }
}

export class NotFoundError extends Error {
  constructor(message = 'Not Found') {
    super(message);
    this.name = 'NotFoundError';
  }
}
export class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class GoneError extends Error {
  constructor(message = 'Gone') {
    super(message);
    this.name = 'GoneError';
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

export function assertIsAuthor(userId: string, authorId: string) {
  if (userId !== authorId) {
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

export async function assertIsMessage(messageId: string) {
  const message = await messageService.getOneById(messageId);
  if (!message) {
    throw new NotFoundError();
  }

  return message;
}

export async function assertIsUser(userId: string) {
  const user = await userService.getOneById(userId);
  if (!user) {
    throw new NotFoundError();
  }

  return user;
}

export async function assertIsUniqueEmail(email: string) {
  const user = await userService.getOneByEmail(email);
  if (user) {
    throw new ConflictError();
  }

  return user;
}

export async function assertIsCorrectPassword(user: User, plainPassword: string) {
  const isValid = await userService.verifyPassword(user, plainPassword);
  if (!isValid) {
    throw new UnauthorizedError();
  }
}

export async function assertIsCorrectEmailAndPassword(userEmail: string, plainPassword: string) {
  const user = await userService.getOneByEmail(userEmail);
  if (!user) {
    throw new UnauthorizedError;
  }

  const isValidPassword = await userService.verifyPassword(user, plainPassword);
  if (!isValidPassword) {
    throw new UnauthorizedError();
  }

  return user;
}

export async function assertIsValidToken(rawToken: string, type: TokenTypes) {
  const token = await tokenService.verify(rawToken, type);
  if (token === 'expired') {
    throw new GoneError();
  }
  if (!token) {
    throw new UnauthorizedError();
  }
  return token;
}

export async function assertHasNoOwnedRooms(userId: string) {
  const hasOwnedRoom = await roomService.hasOwnedRoom(userId);
  if (hasOwnedRoom) {
    throw new ConflictError();
  }
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

export function assertIsMessageId(messageId: string): void {
  if (!messageId) {
    throw new BadRequestError();
  }
}

export function assertIsDifferentUser(userId1: string, userId2: string) {
  if (userId1 === userId2) {
    throw new BadRequestError();
  }
}
