import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { messageEmitter } from './messageEmmiter.js';
import { jwtService } from '../utils/jwt.js';
import type { Message } from '../generated/prisma/client.js';
import { roomService } from '../services/room.service.js';
import * as z from 'zod';

interface ClientToServerEvents {
  'room:join': (roomId: string) => void;
  'room:leave': (roomId: string) => void;
}

interface ServerToClientEvents {
  'room:join:error': (message: string) => void;
  'message:created': (message: Message) => void;
  'message:updated': (message: Message) => void;
  'message:deleted': (data: { messageId: string; roomId: string }) => void;
}

interface InterServerEvents {
  unused: () => void;
}

interface SocketData {
  userId: string;
}

export const io = new Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>({
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

export function attachSocket(server: HttpServer) {
  io.attach(server);

  io.use((socket, next) => {
    const tokenResult = z.string().safeParse(socket.handshake.auth.token);
    if (tokenResult.success === false) {
      return next(new Error('Authentication error'));
    }

    const token = tokenResult.data;

    if (!token) {
      return next(new Error('Authentication error'));
    }

    try {
      const { userId } = jwtService.verify(token);
      socket.data.userId = userId;
    } catch (err) {
      console.error('Socket authentication error:', err);

      return next(new Error('Authentication error'));
    }

    next();
  });

  io.on('connection', (socket) => {
    console.log('A user connected');

    socket.on('room:join', async (roomId) => {
      const isUserInRoom = await roomService.checkIsUserIn(socket.data.userId, roomId);

      if (!isUserInRoom) {
        socket.emit('room:join:error', 'You are not a member of this room');

        return;
      }

      socket.join(roomId);
      console.log(`User ${socket.data.userId} joined room ${roomId}`);
    });

    socket.on('room:leave', (roomId) => {
      socket.leave(roomId);
      console.log(`User ${socket.data.userId} left room ${roomId}`);
    });

    socket.on('disconnect', () => {
      console.log('A user disconnected');
    });
  });

  messageEmitter.on('message:created', (message) => {
    io.to(message.roomId).emit('message:created', message);
  });

  messageEmitter.on('message:updated', (message) => {
    io.to(message.roomId).emit('message:updated', message);
  });

  messageEmitter.on('message:deleted', ({ messageId, roomId }) => {
    io.to(roomId).emit('message:deleted', { messageId, roomId });
  });

  return io;
}
