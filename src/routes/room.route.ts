import express from 'express';
import { catchError } from '../utils/catchError.js';
import { roomController } from '../controllers/room.controller.js';

export const roomRouter = express.Router();

roomRouter.get('/', catchError(roomController.getAll));
roomRouter.post('/', catchError(roomController.create));
roomRouter.delete('/:roomId', catchError(roomController.delete));
roomRouter.patch('/:roomId', catchError(roomController.update));
