import express from 'express';
import cors from 'cors';
import { errorMiddleware } from './middlewares/error.middleware.js';
import { roomRouter } from './routes/room.route.js';

const PORT = process.env.PORT || 3000;
const app = express();

app.use(express.json());
app.use(cors());

app.use('/rooms', roomRouter);

app.listen(PORT);

app.use(errorMiddleware);
