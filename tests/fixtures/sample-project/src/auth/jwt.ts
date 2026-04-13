import jwt from 'jsonwebtoken';
import { getConfig } from '../utils/config.js';

export interface JWTPayload {
  userId: string;
  role: string;
}

export function verifyToken(token: string): JWTPayload {
  const config = getConfig();
  return jwt.verify(token, config.jwtSecret) as JWTPayload;
}

export function signToken(payload: JWTPayload): string {
  const config = getConfig();
  return jwt.sign(payload, config.jwtSecret, { expiresIn: '24h' });
}
