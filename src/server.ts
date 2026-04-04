import express, { Request, Response, NextFunction } from 'express';
import { config } from './config.js';
import { getDb } from './db.js';
import { authMiddleware } from './middleware/auth.js';
import registryRouter from './routes/registry.js';
import tasksRouter from './routes/tasks.js';
import { connectToHarness } from './services/sse-client.js';

export function createApp(): express.Application {
  const app = express();

  app.use(express.json());

  // Health check — no auth
  app.get('/forge/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', version: '1.0.0' });
  });

  // Apply auth to all /forge/* routes (after health)
  app.use('/forge', authMiddleware);

  // Mount routers
  app.use('/forge', registryRouter);
  app.use('/forge', tasksRouter);

  // Global error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[server] Unhandled error:', err);
    res.status(500).json({ error: err.message ?? 'Internal server error' });
  });

  return app;
}

export function startServer(): void {
  // Initialize DB
  getDb();
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
