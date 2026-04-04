import { Router, Request, Response, NextFunction } from 'express';
import { getAllContainers, getContainer, upsertContainer, updateContainer, deleteContainer } from '../db/index.js';
import { config } from '../config.js';
import { ValidationError, NotFoundError } from '../errors.js';

const router = Router();

// POST /forge/register — register or update a container
router.post('/register', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
  const { container_id, project_name, repo_url, host, port, telegram_bot_token, telegram_chat_id } = req.body as Record<string, unknown>;

  if (!container_id || !project_name || !repo_url || !host || !port || !telegram_bot_token || !telegram_chat_id) {
    throw new ValidationError('Missing required fields: container_id, project_name, repo_url, host, port, telegram_bot_token, telegram_chat_id');
  }

  // Ensure project exists in harness (ignore 409 conflict)
  try {
    const resp = await fetch(`${config.harnessUrl}/v1/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: project_name, repo_url }),
    });
    if (!resp.ok && resp.status !== 409) {
      console.warn(`[registry] POST /v1/projects returned ${resp.status} — continuing anyway`);
    }
  } catch (err) {
    console.warn('[registry] Failed to call harness /v1/projects:', err);
  }

  const container = upsertContainer({
    container_id: String(container_id),
    project_name: String(project_name),
    repo_url: String(repo_url),
    host: String(host),
    port: Number(port),
    telegram_bot_token: String(telegram_bot_token),
    telegram_chat_id: String(telegram_chat_id),
  });

  res.json({ ok: true, container_id: container.container_id });
  } catch (err) { next(err); }
});

// GET /forge/registry — list all containers
router.get('/registry', (_req: Request, res: Response, next: NextFunction): void => {
  try {
    const containers = getAllContainers();
    res.json({ containers });
  } catch (err) { next(err); }
});

// POST /forge/registry/:container_id — update a container entry
router.post('/registry/:container_id', (req: Request, res: Response, next: NextFunction): void => {
  try {
  const { container_id } = req.params;
  const existing = getContainer(container_id);
  if (!existing) {
    throw new NotFoundError(`Container ${container_id} not found`);
  }

  const allowedFields = ['project_name', 'repo_url', 'host', 'port', 'telegram_bot_token', 'telegram_chat_id', 'active'];
  const fields: Record<string, unknown> = {};
  for (const f of allowedFields) {
    if (req.body[f] !== undefined) {
      fields[f] = req.body[f];
    }
  }

  const updated = updateContainer(container_id, fields as Parameters<typeof updateContainer>[1]);
  res.json({ ok: true, container: updated });
  } catch (err) { next(err); }
});

// DELETE /forge/registry/:container_id — soft-delete (deactivate) a container
router.delete('/registry/:container_id', (req: Request, res: Response, next: NextFunction): void => {
  try {
  const { container_id } = req.params;
  const ok = deleteContainer(container_id);
  if (!ok) {
    throw new NotFoundError(`Container ${container_id} not found`);
  }
  res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
