import express from 'express';
import cors from 'cors';
import { errorMiddleware } from './middlewares/error.middleware.js';
import { roomRouter } from './routes/room.route.js';
import { messageRouter } from './routes/message.route.js';
import { userRouter } from './routes/user.route.js';
import http from 'http';
import { attachSocket } from './lib/socket.js';
import helmet from 'helmet';

const PORT = process.env.PORT || 3000;
const app = express();

// See src/lib/socket.ts for why this matters: only trust X-Forwarded-For
// when actually deployed behind a reverse proxy that sets it correctly.
if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

app.use(helmet());
app.use(express.json());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN?.split(',') || '*',
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);

app.use('/rooms', roomRouter);
app.use('/messages', messageRouter);
app.use('/users', userRouter);

app.use(errorMiddleware);

const server = http.createServer(app);

attachSocket(server);

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
