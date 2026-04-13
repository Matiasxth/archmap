import { verifyToken } from './jwt.js';
import { getUserById } from '../db/index.js';
import type { Request, Response, NextFunction } from 'express';

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });

  const payload = verifyToken(token);
  const user = await getUserById(payload.userId);
  (req as any).user = user;
  next();
}
