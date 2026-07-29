import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { messageEmitter } from './messageEmmiter.js';

export const io = new Server({
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

export function attachSocket(server: HttpServer) {
  io.attach(server);

  io.on('connection', (socket) => {
    console.log('A user connected');

    socket.on('disconnect', () => {
      console.log('A user disconnected');
    });
  });

  messageEmitter.on('message:created', (message) => {
    io.emit('message:created', message);
  });

  messageEmitter.on('message:updated', (message) => {
    io.emit('message:updated', message);
  });

  messageEmitter.on('message:deleted', ({ messageId, roomId }) => {
    io.emit('message:deleted', { messageId, roomId });
  });

  return io;
}
