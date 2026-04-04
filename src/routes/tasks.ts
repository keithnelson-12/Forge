import { Router, Request, Response } from 'express';
import { getContainer, getAllContainers, mapTask } from '../db.js';
import { config } from '../config.js';

const router = Router();

// POST /forge/request — submit a build request
router.post('/request', async (req: Request, res: Response): Promise<void> => {
  const { container_id, description, is_new_project, type, build_mode, assignee } = req.body as Record<string, unknown>;

  if (!container_id || description === undefined || is_new_project === undefined) {
    res.status(400).json({ error: 'Missing required fields: container_id, description, is_new_project' });
    return;
  }

  const container = getContainer(String(container_id));
  if (!container) {
    res.status(404).json({ error: `Container ${container_id} not found in registry` });
    return;
  }

  const harnessBody: Record<string, unknown> = {
    description,
    project_name: container.project_name,
    repo_url: container.repo_url,
    is_new_project,
  };
  if (type !== undefined) harnessBody['type'] = type;
  if (build_mode !== undefined) harnessBody['build_mode'] = build_mode;
  if (assignee !== undefined) harnessBody['assignee'] = assignee;

  let harnessRes: Response | undefined;
  let harnessData: Record<string, unknown>;

  try {
    const resp = await fetch(`${config.harnessUrl}/v1/requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(harnessBody),
    });

    harnessData = await resp.json() as Record<string, unknown>;

    if (!resp.ok) {
      res.status(resp.status).json(harnessData);
      return;
    }
  } catch (err) {
    console.error('[tasks] POST /v1/requests error:', err);
    res.status(502).json({ error: 'Failed to reach harness' });
    return;
  }

  const task = harnessData['task'] as Record<string, unknown> | undefined;
  const taskId = task?.['id'] as string | undefined;

  if (taskId) {
    mapTask(taskId, container.container_id, container.project_name);
  }

  res.json({
    task_id: taskId,
    status: task?.['status'],
    queue_position: harnessData['queue_position'],
  });
});

// GET /forge/status/:task_id — get one-line status
router.get('/status/:task_id', async (req: Request, res: Response): Promise<void> => {
  const { task_id } = req.params;

  try {
    const resp = await fetch(`${config.harnessUrl}/v1/runs/${task_id}`);
    const data = await resp.json() as Record<string, unknown>;

    if (!resp.ok) {
      res.status(resp.status).json(data);
      return;
    }

    const task = data['task'] as Record<string, unknown> | undefined;
    const project = data['project'] as Record<string, unknown> | undefined;

    res.json({
      task_id,
      status: task?.['status'],
      title: task?.['title'] ?? task?.['description'],
      project_name: project?.['name'],
    });
  } catch (err) {
    console.error('[tasks] GET /v1/runs error:', err);
    res.status(502).json({ error: 'Failed to reach harness' });
  }
});

// GET /forge/tasks?container_id=x — list tasks for a container
router.get('/tasks', async (req: Request, res: Response): Promise<void> => {
  const container_id = req.query['container_id'] as string | undefined;

  if (!container_id) {
    res.status(400).json({ error: 'Missing query parameter: container_id' });
    return;
  }

  const container = getContainer(container_id);
  if (!container) {
    res.status(404).json({ error: `Container ${container_id} not found in registry` });
    return;
  }

  try {
    const resp = await fetch(`${config.harnessUrl}/v1/runs`);
    const data = await resp.json() as Record<string, unknown>;

    if (!resp.ok) {
      res.status(resp.status).json(data);
      return;
    }

    const runs = (data['runs'] as Record<string, unknown>[]) ?? [];

    // Filter by project_name matching container's project
    const filtered = runs.filter((run) => {
      const project = run['project'] as Record<string, unknown> | undefined;
      const task = run['task'] as Record<string, unknown> | undefined;
      const projectName = project?.['name'] ?? task?.['project_name'];
      return projectName === container.project_name;
    });

    const simplified = filtered.map((run) => {
      const task = run['task'] as Record<string, unknown> | undefined;
      const project = run['project'] as Record<string, unknown> | undefined;
      return {
        task_id: task?.['id'],
        status: task?.['status'],
        title: task?.['title'] ?? task?.['description'],
        project_name: project?.['name'] ?? container.project_name,
        created_at: task?.['created_at'],
      };
    });

    res.json({ tasks: simplified });
  } catch (err) {
    console.error('[tasks] GET /v1/runs error:', err);
    res.status(502).json({ error: 'Failed to reach harness' });
  }
});

// POST /forge/cancel/:task_id — cancel a task
router.post('/cancel/:task_id', async (req: Request, res: Response): Promise<void> => {
  const { task_id } = req.params;

  try {
    const resp = await fetch(`${config.harnessUrl}/v1/orchestrator/cancel/${task_id}`, {
      method: 'POST',
    });
    const data = await resp.json() as Record<string, unknown>;
    res.status(resp.status).json(data);
  } catch (err) {
    console.error('[tasks] POST /v1/orchestrator/cancel error:', err);
    res.status(502).json({ error: 'Failed to reach harness' });
  }
});

// POST /forge/stop — emergency stop
router.post('/stop', async (_req: Request, res: Response): Promise<void> => {
  try {
    const resp = await fetch(`${config.harnessUrl}/v1/orchestrator/emergency-stop`, {
      method: 'POST',
    });
    const data = await resp.json() as Record<string, unknown>;
    res.status(resp.status).json(data);
  } catch (err) {
    console.error('[tasks] POST /v1/orchestrator/emergency-stop error:', err);
    res.status(502).json({ error: 'Failed to reach harness' });
  }
});

export default router;
