/**
 * Task route handler tests — run with:
 *   node --import tsx/esm --test src/routes/tasks.test.ts
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { Server } from 'node:http';

const API_KEY = 'test-tasks-key';
const HARNESS_URL = 'http://10.0.0.2:4000';

let server: Server;
let baseUrl: string;
let rawDb: import('better-sqlite3').Database;

// Mocked harness responses — tests can override these
let mockHarnessResponse: { status: number; body: unknown } = { status: 200, body: {} };

before(async () => {
  process.env['HARNESS_URL'] = HARNESS_URL;
  process.env['FORGE_DB_PATH'] = ':memory:';
  process.env['FORGE_API_KEY'] = API_KEY;
  process.env['FORGE_PORT'] = '0';

  // Install fetch mock — intercept harness calls, pass everything else through
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as Request).url;
    if (urlStr.startsWith(HARNESS_URL)) {
      return new Response(JSON.stringify(mockHarnessResponse.body), {
        status: mockHarnessResponse.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return originalFetch(url as Parameters<typeof originalFetch>[0], init);
  };

  const dbMod = await import('../db/index.js');
  rawDb = dbMod.initDatabase(':memory:');

  const { createApp } = await import('../server.js');
  const app = createApp();

  await new Promise<void>((resolve) => {
    server = createServer(app as Parameters<typeof createServer>[0]);
    server.listen(0, '127.0.0.1', resolve);
  });

  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(() => {
  server?.close();
  delete process.env['HARNESS_URL'];
  delete process.env['FORGE_DB_PATH'];
  delete process.env['FORGE_API_KEY'];
  delete process.env['FORGE_PORT'];
});

const VALID_CONTAINER = {
  container_id: 'ctr-tasks-001',
  project_name: 'tasks-test-project',
  repo_url: 'https://github.com/org/tasks-repo',
  host: '10.0.2.5',
  port: 3000,
  telegram_bot_token: 'bot:BBBB',
  telegram_chat_id: '-1009876543',
};

beforeEach(() => {
  rawDb.exec('DELETE FROM task_map; DELETE FROM containers;');
  // Re-insert the valid container so task routes can find it
  rawDb.prepare(`
    INSERT INTO containers (container_id, project_name, repo_url, host, port, telegram_bot_token, telegram_chat_id, registered_at, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), 1)
  `).run(
    VALID_CONTAINER.container_id,
    VALID_CONTAINER.project_name,
    VALID_CONTAINER.repo_url,
    VALID_CONTAINER.host,
    VALID_CONTAINER.port,
    VALID_CONTAINER.telegram_bot_token,
    VALID_CONTAINER.telegram_chat_id,
  );
  // Reset harness mock to a success default
  mockHarnessResponse = { status: 200, body: {} };
});

function authHeaders(): Record<string, string> {
  return { 'x-forge-key': API_KEY, 'Content-Type': 'application/json' };
}

// ── POST /forge/request ──────────────────────────────────────────────────────

describe('POST /forge/request', () => {
  it('with valid body and mocked harness response returns task_id and status', async () => {
    mockHarnessResponse = {
      status: 200,
      body: {
        task: { id: 'task-abc-123', status: 'queued' },
        queue_position: 2,
      },
    };

    const res = await fetch(`${baseUrl}/forge/request`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        container_id: VALID_CONTAINER.container_id,
        description: 'Build the widget',
        is_new_project: false,
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assert.equal(body['task_id'], 'task-abc-123');
    assert.equal(body['status'], 'queued');
    assert.equal(body['queue_position'], 2);

    // task_map should be populated
    const row = rawDb.prepare('SELECT * FROM task_map WHERE task_id = ?').get('task-abc-123') as Record<string, unknown> | undefined;
    assert.ok(row !== undefined, 'task_map entry should be created');
    assert.equal(row['container_id'], VALID_CONTAINER.container_id);
  });

  it('with missing fields returns 400', async () => {
    const res = await fetch(`${baseUrl}/forge/request`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        container_id: VALID_CONTAINER.container_id,
        // missing description and is_new_project
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json() as Record<string, unknown>;
    const err = body['error'] as Record<string, unknown>;
    assert.ok(err !== null && typeof err === 'object', 'response should have error object');
    assert.equal(err['code'], 'VALIDATION_ERROR');
  });

  it('for unknown container returns 404', async () => {
    const res = await fetch(`${baseUrl}/forge/request`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        container_id: 'does-not-exist',
        description: 'Some task',
        is_new_project: false,
      }),
    });

    assert.equal(res.status, 404);
    const body = await res.json() as Record<string, unknown>;
    const err = body['error'] as Record<string, unknown>;
    assert.ok(err !== null && typeof err === 'object');
    assert.ok('code' in err);
    assert.ok('message' in err);
  });

  it('for inactive container returns 403', async () => {
    // Deactivate the container
    rawDb.prepare("UPDATE containers SET active = 0 WHERE container_id = ?").run(VALID_CONTAINER.container_id);

    const res = await fetch(`${baseUrl}/forge/request`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        container_id: VALID_CONTAINER.container_id,
        description: 'Some task',
        is_new_project: false,
      }),
    });

    assert.equal(res.status, 403);
    const body = await res.json() as Record<string, unknown>;
    const err = body['error'] as Record<string, unknown>;
    assert.ok(err !== null && typeof err === 'object');
  });
});

// ── GET /forge/status/:task_id ───────────────────────────────────────────────

describe('GET /forge/status/:task_id', () => {
  it('proxies to harness and returns simplified response', async () => {
    mockHarnessResponse = {
      status: 200,
      body: {
        task: { id: 'task-xyz-456', status: 'running', title: 'Build widget' },
        project: { name: 'tasks-test-project', id: 'proj-001' },
      },
    };

    const res = await fetch(`${baseUrl}/forge/status/task-xyz-456`, {
      headers: { 'x-forge-key': API_KEY },
    });

    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assert.equal(body['task_id'], 'task-xyz-456');
    assert.equal(body['status'], 'running');
    assert.equal(body['title'], 'Build widget');
    assert.equal(body['project_name'], 'tasks-test-project');
  });
});

// ── GET /forge/tasks ─────────────────────────────────────────────────────────

describe('GET /forge/tasks', () => {
  it('returns filtered task list for known container_id', async () => {
    mockHarnessResponse = {
      status: 200,
      body: {
        runs: [
          {
            task: { id: 'task-1', status: 'completed', title: 'Task One', created_at: '2026-04-01T00:00:00Z' },
            project: { id: 'proj-A', name: VALID_CONTAINER.project_name },
          },
          {
            task: { id: 'task-2', status: 'running', title: 'Task Two', created_at: '2026-04-02T00:00:00Z' },
            project: { id: 'proj-B', name: 'other-project' },
          },
        ],
      },
    };

    const res = await fetch(
      `${baseUrl}/forge/tasks?container_id=${encodeURIComponent(VALID_CONTAINER.container_id)}`,
      { headers: { 'x-forge-key': API_KEY } },
    );

    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assert.ok(Array.isArray(body['tasks']), 'tasks should be an array');
    const tasks = body['tasks'] as Array<Record<string, unknown>>;
    // Only the run matching this container's project_name should be included
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0]!['task_id'], 'task-1');
    assert.equal(tasks[0]!['status'], 'completed');
  });

  it('without container_id returns 400', async () => {
    const res = await fetch(`${baseUrl}/forge/tasks`, {
      headers: { 'x-forge-key': API_KEY },
    });

    assert.equal(res.status, 400);
    const body = await res.json() as Record<string, unknown>;
    const err = body['error'] as Record<string, unknown>;
    assert.ok(err !== null && typeof err === 'object');
    assert.equal(err['code'], 'VALIDATION_ERROR');
  });
});

// ── POST /forge/cancel/:task_id ──────────────────────────────────────────────

describe('POST /forge/cancel/:task_id', () => {
  it('proxies to harness and returns response', async () => {
    mockHarnessResponse = {
      status: 200,
      body: { ok: true, message: 'Task canceled' },
    };

    const res = await fetch(`${baseUrl}/forge/cancel/task-to-cancel`, {
      method: 'POST',
      headers: authHeaders(),
    });

    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assert.equal(body['ok'], true);
  });
});

// ── POST /forge/stop ─────────────────────────────────────────────────────────

describe('POST /forge/stop', () => {
  it('proxies emergency stop to harness and returns response', async () => {
    mockHarnessResponse = {
      status: 200,
      body: { ok: true, message: 'Emergency stop triggered' },
    };

    const res = await fetch(`${baseUrl}/forge/stop`, {
      method: 'POST',
      headers: authHeaders(),
    });

    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assert.equal(body['ok'], true);
  });
});
