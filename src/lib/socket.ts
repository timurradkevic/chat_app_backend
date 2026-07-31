import type { Server as HttpServer } from 'http';
import { randomUUID } from 'crypto';
import { Server, Socket } from 'socket.io';
import { messageEmitter } from './messageEmmiter.js';
import { jwtService } from '../utils/jwt.js';
import type { Message } from '../generated/prisma/client.js';
import { roomService } from '../services/room.service.js';
import * as z from 'zod';
import { logger } from './logger.js';
import { pubClient, redis, subClient } from './redis.js';
import { createAdapter } from '@socket.io/redis-adapter';

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

export const CORS_ORIGIN = process.env.CORS_ORIGIN?.split(',');

if (!CORS_ORIGIN) {
  throw new Error('CORS_ORIGIN environment variable is not set');
}

export const io = new Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>({
  cors: {
    origin: CORS_ORIGIN,
    methods: ['GET', 'POST'],
  },
});

const MAX_CONNECTIONS_PER_IP = 10;

const ROOM_EVENT_LIMIT = 20;
const ROOM_EVENT_WINDOW_MS = 10_000;

// When running behind a reverse proxy (nginx, ALB, Cloudflare, etc.),
// socket.handshake.address is the proxy's own IP for every connection,
// which collapses all clients into one bucket for the per-IP connection
// limit. Set TRUST_PROXY=true only if the app is actually deployed behind
// a trusted proxy that sets X-Forwarded-For correctly (and strips/overwrites
// any client-supplied value) — otherwise this header can be spoofed.
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';

async function incrementConnectionCount(ip: string): Promise<number> {
  const key = `socket:connections:${ip}`;

  const count = await redis.incr(key);

  if (count === 1) {
    await redis.expire(key, 60);
  }

  return count;
}

async function decrementConnectionCount(ip: string) {
  const key = `socket:connections:${ip}`;

  await redis.atomicDecrement(key);
}

async function isRoomEventAllowed(
  socket: Socket<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >,
): Promise<boolean> {
  const now = Date.now();

  const key = `socket:room-events:${socket.id}`;

  const allowed = await redis.slidingWindowRateLimit(
    key,
    now,
    ROOM_EVENT_WINDOW_MS,
    ROOM_EVENT_LIMIT,
    `${now}-${randomUUID()}`,
    Math.ceil(ROOM_EVENT_WINDOW_MS / 1000),
  );

  return allowed === 1;
}

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
  io.adapter(createAdapter(pubClient, subClient));
  io.attach(server);

  io.use(async (socket, next) => {
    const tokenResult = z.string().safeParse(socket.handshake.auth.token);
    if (tokenResult.success === false) {
      return next(new Error('Authentication error'));
    }

    const token = tokenResult.data;

    if (!token) {
      return next(new Error('Authentication error'));
    }

    const ip = getClientIp(socket);
    let count: number;

    try {
      count = await incrementConnectionCount(ip);
    } catch (err) {
      logger.error(err, 'Redis error while incrementing connection count');
      return next(new Error('Internal server error'));
    }

    if (count > MAX_CONNECTIONS_PER_IP) {
      try {
        await decrementConnectionCount(ip);
      } catch (err) {
        logger.error(err, 'Redis error while decrementing connection count');
      }

      return next(new Error('Too many connections from this IP'));
    }

    try {
      const { userId } = jwtService.verify(token);
      socket.data.userId = userId;
    } catch (err) {
      logger.error(err, 'Socket authentication error');

      try {
        await decrementConnectionCount(ip);
      } catch (redisErr) {
        logger.error(
          redisErr,
          'Redis error while decrementing connection count',
        );
      }

      return next(new Error('Authentication error'));
    }

    next();
  });

  io.on('connection', (socket) => {
    logger.info({ userId: socket.data.userId }, 'A user connected');

    socket.on('room:join', async (roomId) => {
      try {
        if (!(await isRoomEventAllowed(socket))) {
          socket.emit('room:join:error', 'Too many requests, slow down');
          return;
        }
      } catch (err) {
        logger.error(err, 'Redis error while checking room event rate limit');
        socket.emit('room:join:error', 'Internal server error');
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
      logger.info({ userId: socket.data.userId, roomId }, 'User joined room');
    });

    socket.on('room:leave', async (roomId) => {
      try {
        if (!(await isRoomEventAllowed(socket))) {
          return;
        }
      } catch (err) {
        logger.error(err, 'Redis error while checking room event rate limit');
        return;
      }

      socket.leave(roomId);
      logger.info({ userId: socket.data.userId, roomId }, 'User left room');
    });

    socket.on('disconnect', async () => {
      try {
        await decrementConnectionCount(getClientIp(socket));
        await redis.del(`socket:room-events:${socket.id}`);
      } catch (err) {
        logger.error(err, 'Redis error during socket disconnect cleanup');
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
