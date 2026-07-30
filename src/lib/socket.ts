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
  roomEventTimestamps: number[];
}

export const io = new Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>({
  cors: {
    origin: process.env.CORS_ORIGIN?.split(',') || '*',
    methods: ['GET', 'POST'],
  },
});

const MAX_CONNECTIONS_PER_IP = 10;
const connectionCounts = new Map<string, number>();

const ROOM_EVENT_LIMIT = 20;
const ROOM_EVENT_WINDOW_MS = 10_000;

// When running behind a reverse proxy (nginx, ALB, Cloudflare, etc.),
// socket.handshake.address is the proxy's own IP for every connection,
// which collapses all clients into one bucket for the per-IP connection
// limit. Set TRUST_PROXY=true only if the app is actually deployed behind
// a trusted proxy that sets X-Forwarded-For correctly (and strips/overwrites
// any client-supplied value) — otherwise this header can be spoofed.
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';

function getClientIp(socket: {
  handshake: { address: string; headers: Record<string, unknown> };
}): string {
  if (TRUST_PROXY) {
    const forwardedFor = socket.handshake.headers['x-forwarded-for'];
    const forwardedValue = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : forwardedFor;

    if (typeof forwardedValue === 'string' && forwardedValue.length > 0) {
      return (forwardedValue.split(',')[0] ?? '').trim();
    }
  }

  return socket.handshake.address;
}

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

    const ip = getClientIp(socket);
    const currentCount = connectionCounts.get(ip) ?? 0;

    if (currentCount >= MAX_CONNECTIONS_PER_IP) {
      return next(new Error('Too many connections from this IP'));
    }

    try {
      const { userId } = jwtService.verify(token);
      socket.data.userId = userId;
      socket.data.roomEventTimestamps = [];
    } catch (err) {
      console.error('Socket authentication error:', err);

      return next(new Error('Authentication error'));
    }

    connectionCounts.set(ip, currentCount + 1);

    next();
  });

  io.on('connection', (socket) => {
    console.log('A user connected');

    function isRoomEventAllowed(): boolean {
      const now = Date.now();
      const timestamps = socket.data.roomEventTimestamps.filter(
        (ts) => now - ts < ROOM_EVENT_WINDOW_MS,
      );

      if (timestamps.length >= ROOM_EVENT_LIMIT) {
        socket.data.roomEventTimestamps = timestamps;
        return false;
      }

      timestamps.push(now);
      socket.data.roomEventTimestamps = timestamps;
      return true;
    }

    socket.on('room:join', async (roomId) => {
      if (!isRoomEventAllowed()) {
        socket.emit('room:join:error', 'Too many requests, slow down');
        return;
      }

      const isUserInRoom = await roomService.checkIsUserIn(
        socket.data.userId,
        roomId,
      );

      if (!isUserInRoom) {
        socket.emit('room:join:error', 'You are not a member of this room');

        return;
      }

      socket.join(roomId);
      console.log(`User ${socket.data.userId} joined room ${roomId}`);
    });

    socket.on('room:leave', (roomId) => {
      if (!isRoomEventAllowed()) {
        return;
      }

      socket.leave(roomId);
      console.log(`User ${socket.data.userId} left room ${roomId}`);
    });

    socket.on('disconnect', () => {
      console.log('A user disconnected');

      const ip = getClientIp(socket);
      const currentCount = connectionCounts.get(ip) ?? 0;

      if (currentCount <= 1) {
        connectionCounts.delete(ip);
      } else {
        connectionCounts.set(ip, currentCount - 1);
      }
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
