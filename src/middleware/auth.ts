import { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';
import { AppError } from '../errors.js';

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'] as string | undefined;
  const forgeKey = req.headers['x-forge-key'] as string | undefined;

  let token: string | undefined;

  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (forgeKey) {
    token = forgeKey;
  }

  if (!token) {
    next(new AppError('Missing authentication', 401, 'UNAUTHORIZED'));
    return;
  }

  if (token !== config.apiKey) {
    next(new AppError('Invalid credentials', 401, 'UNAUTHORIZED'));
    return;
  }

  next();
}
