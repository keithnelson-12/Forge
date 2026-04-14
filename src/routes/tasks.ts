import { Router, Request, Response, NextFunction } from 'express';
import { getContainer, mapTask } from '../db/index.js';
import { config } from '../config.js';
import { AppError, ValidationError, NotFoundError } from '../errors.js';

const router = Router();

// POST /forge/request — submit a build request
router.post('/request', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
  const { container_id, description, assignee, pm_task_id, pm_subtask_id } = req.body as Record<string, unknown>;

  if (!container_id || description === undefined) {
    throw new ValidationError('Missing required fields: container_id, description');
  }

  if (pm_task_id && pm_subtask_id) {
    throw new ValidationError('pm_task_id and pm_subtask_id are mutually exclusive — provide one or the other, not both');
  }

  const container = getContainer(String(container_id));
  if (!container) {
    throw new NotFoundError(`Container ${container_id} not found in registry`);
  }

  if (!container.active) {
    throw new AppError(`Container ${container_id} is inactive`, 403, 'FORBIDDEN');
  }

  // Enforce project scope — prepend project context so DH knows exactly
  // which project this task belongs to. The bot cannot override this.
  const scopedDescription = [
    `[PROJECT SCOPE: ${container.project_name} — repo: ${container.repo_url}]`,
    `All work MUST target this project only. Do NOT reference or modify files outside this repository.`,
    ``,
    String(description),
  ].join('\n');

  // Slim request body — project_name is the source of truth, repo_url/is_new_project
  // are derived from the registered project on the DH side, type/workflow/build_mode
  // are auto-determined by triage, auto_approve is always on.
  const harnessBody: Record<string, unknown> = {
    description: scopedDescription,
    project_name: container.project_name,
  };
  if (assignee !== undefined) harnessBody['assignee'] = assignee;
  if (pm_task_id !== undefined) harnessBody['pm_task_id'] = pm_task_id;
  if (pm_subtask_id !== undefined) harnessBody['pm_subtask_id'] = pm_subtask_id;

  let harnessData: Record<string, unknown>;

  try {
    const resp = await fetch(`${config.harnessUrl}/v1/requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(harnessBody),
    });

    harnessData = await resp.json() as Record<string, unknown>;

    if (!resp.ok) {
      const errData = harnessData['error'] as Record<string, unknown> | undefined;
      throw new AppError(
        String(errData?.['message'] ?? `Harness returned ${resp.status}`),
        resp.status,
        String(errData?.['code'] ?? `ERR_${resp.status}`),
      );
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('[tasks] POST /v1/requests error:', err);
    throw new AppError('Failed to reach harness', 502, 'BAD_GATEWAY');
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
  } catch (err) { next(err); }
});

// GET /forge/status/:task_id — get one-line status
router.get('/status/:task_id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { task_id } = req.params;

    let data: Record<string, unknown>;
    try {
      const resp = await fetch(`${config.harnessUrl}/v1/runs/${task_id}`);
      data = await resp.json() as Record<string, unknown>;

      if (!resp.ok) {
        const errData = data['error'] as Record<string, unknown> | undefined;
        throw new AppError(
          String(errData?.['message'] ?? `Harness returned ${resp.status}`),
          resp.status,
          String(errData?.['code'] ?? `ERR_${resp.status}`),
        );
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      console.error('[tasks] GET /v1/runs/:task_id error:', err);
      throw new AppError('Failed to reach harness', 502, 'BAD_GATEWAY');
    }

    const task = data['task'] as Record<string, unknown> | undefined;
    const project = data['project'] as Record<string, unknown> | undefined;

    res.json({
      task_id,
      status: task?.['status'],
      title: task?.['title'] ?? task?.['description'],
      project_name: project?.['name'],
    });
  } catch (err) { next(err); }
});

// GET /forge/tasks?container_id=x — list tasks for a container
router.get('/tasks', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
  const container_id = req.query['container_id'] as string | undefined;

  if (!container_id) {
    throw new ValidationError('Missing query parameter: container_id');
  }

  const container = getContainer(container_id);
  if (!container) {
    throw new NotFoundError(`Container ${container_id} not found in registry`);
  }

  let data: Record<string, unknown>;
  try {
    const resp = await fetch(`${config.harnessUrl}/v1/runs`);
    data = await resp.json() as Record<string, unknown>;

    if (!resp.ok) {
      const errData = data['error'] as Record<string, unknown> | undefined;
      throw new AppError(
        String(errData?.['message'] ?? `Harness returned ${resp.status}`),
        resp.status,
        String(errData?.['code'] ?? `ERR_${resp.status}`),
      );
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('[tasks] GET /v1/runs error:', err);
    throw new AppError('Failed to reach harness', 502, 'BAD_GATEWAY');
  }

  const runs = (data['runs'] as Record<string, unknown>[]) ?? [];

  // Derive project_id by finding the first run whose project name matches,
  // then filter all runs by that canonical project_id.
  let projectId: string | undefined;
  for (const run of runs) {
    const project = run['project'] as Record<string, unknown> | undefined;
    if (project?.['name'] === container.project_name && project?.['id']) {
      projectId = String(project['id']);
      break;
    }
  }

  const filtered = runs.filter((run) => {
    const project = run['project'] as Record<string, unknown> | undefined;
    if (projectId) {
      return project?.['id'] !== undefined && String(project['id']) === projectId;
    }
    // Fallback: no project_id found yet — keep runs matching by name
    return project?.['name'] === container.project_name;
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
  } catch (err) { next(err); }
});

// POST /forge/cancel/:task_id — cancel a task
router.post('/cancel/:task_id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { task_id } = req.params;
    let data: Record<string, unknown>;
    try {
      const resp = await fetch(`${config.harnessUrl}/v1/orchestrator/cancel/${task_id}`, {
        method: 'POST',
      });
      data = await resp.json() as Record<string, unknown>;
      if (!resp.ok) {
        const errData = data['error'] as Record<string, unknown> | undefined;
        throw new AppError(
          String(errData?.['message'] ?? `Harness returned ${resp.status}`),
          resp.status,
          String(errData?.['code'] ?? `ERR_${resp.status}`),
        );
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      console.error('[tasks] POST cancel error:', err);
      throw new AppError('Failed to reach harness', 502, 'BAD_GATEWAY');
    }
    res.json(data);
  } catch (err) { next(err); }
});

// POST /forge/stop — emergency stop
router.post('/stop', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    let data: Record<string, unknown>;
    try {
      const resp = await fetch(`${config.harnessUrl}/v1/orchestrator/emergency-stop`, {
        method: 'POST',
      });
      data = await resp.json() as Record<string, unknown>;
      if (!resp.ok) {
        const errData = data['error'] as Record<string, unknown> | undefined;
        throw new AppError(
          String(errData?.['message'] ?? `Harness returned ${resp.status}`),
          resp.status,
          String(errData?.['code'] ?? `ERR_${resp.status}`),
        );
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      console.error('[tasks] POST emergency-stop error:', err);
      throw new AppError('Failed to reach harness', 502, 'BAD_GATEWAY');
    }
    res.json(data);
  } catch (err) { next(err); }
});

export default router;
