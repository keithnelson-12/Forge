import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { config } from './config.js';
import { initDatabase } from './db/index.js';
import { authMiddleware } from './middleware/auth.js';
import { requestLogger } from './middleware/logger.js';
import { errorHandler } from './middleware/error-handler.js';
import { NotFoundError } from './errors.js';
import registryRouter from './routes/registry.js';
import tasksRouter from './routes/tasks.js';
import { connectToHarness } from './services/sse-client.js';

export function createApp(): express.Application {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(requestLogger);

  // Health check — no auth
  app.get('/forge/health', (_req: Request, res: Response) => {
    res.json({ ok: true, version: '1.0.0', harness_url: config.harnessUrl });
  });

  // Apply auth to all /forge/* routes (after health)
  app.use('/forge', authMiddleware);

  // Mount routers
  app.use('/forge', registryRouter);
  app.use('/forge', tasksRouter);

  // 404 catch-all for unknown routes
  app.use((_req: Request, _res: Response, next: NextFunction) => {
    next(new NotFoundError('Route not found'));
  });

  // Global error handler
  app.use(errorHandler);

  return app;
}

export function startServer(): void {
  // Initialize DB
  initDatabase(config.dbPath);
  console.log(`[forge] Database initialized at ${config.dbPath}`);

  // Log config (redact API key)
  console.log('[forge] Config:', {
    port: config.port,
    harnessUrl: config.harnessUrl,
    dbPath: config.dbPath,
    apiKey: config.apiKey.slice(0, 4) + '****',
  });

  const app = createApp();

  app.listen(config.port, () => {
    console.log(`[forge] Listening on port ${config.port}`);

    // Connect to harness SSE after server is up
    connectToHarness();
  });
}
