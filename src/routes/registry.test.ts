/**
 * Registry route handler tests — run with:
 *   node --import tsx/esm --test src/routes/registry.test.ts
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { Server } from 'node:http';

const API_KEY = 'test-registry-key';
const HARNESS_URL = 'http://10.0.0.1:4000';

let server: Server;
let baseUrl: string;
let rawDb: import('better-sqlite3').Database;

before(async () => {
  process.env['HARNESS_URL'] = HARNESS_URL;
  process.env['FORGE_DB_PATH'] = ':memory:';
  process.env['FORGE_API_KEY'] = API_KEY;
  process.env['FORGE_PORT'] = '0';

  // Mock fetch — intercept harness calls only, forward everything else
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as Request).url;
    if (urlStr.startsWith(HARNESS_URL)) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
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

beforeEach(() => {
  rawDb.exec('DELETE FROM task_map; DELETE FROM containers;');
});

const VALID_CONTAINER = {
  container_id: 'ctr-test-001',
  project_name: 'test-project',
  repo_url: 'https://github.com/org/test-repo',
  host: '10.0.1.5',
  port: 3000,
  telegram_bot_token: 'bot:AAAA',
  telegram_chat_id: '-1001234567',
};

function authHeaders(): Record<string, string> {
  return { 'x-forge-key': API_KEY, 'Content-Type': 'application/json' };
}

describe('POST /forge/register', () => {
  it('with valid body returns 200 and creates container in DB', async () => {
    const res = await fetch(`${baseUrl}/forge/register`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(VALID_CONTAINER),
    });
    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assert.equal(body['ok'], true);
    assert.equal(body['container_id'], VALID_CONTAINER.container_id);

    // Verify container was persisted in DB
    const row = rawDb.prepare('SELECT * FROM containers WHERE container_id = ?').get(VALID_CONTAINER.container_id) as Record<string, unknown> | undefined;
    assert.ok(row !== undefined, 'container should exist in DB');
    assert.equal(row['project_name'], VALID_CONTAINER.project_name);
    assert.equal(row['active'], 1);
  });

  it('with missing fields returns 400 VALIDATION_ERROR', async () => {
    const partial = {
      container_id: 'ctr-partial',
      project_name: 'partial-project',
      // missing: repo_url, host, port, telegram_bot_token, telegram_chat_id
    };
    const res = await fetch(`${baseUrl}/forge/register`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(partial),
    });
    assert.equal(res.status, 400);
    const body = await res.json() as Record<string, unknown>;
    const err = body['error'] as Record<string, unknown>;
    assert.ok(err !== null && typeof err === 'object', 'response should have error object');
    assert.equal(err['code'], 'VALIDATION_ERROR');
  });
});

describe('GET /forge/registry', () => {
  it('returns list of containers', async () => {
    // Register one first
    await fetch(`${baseUrl}/forge/register`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(VALID_CONTAINER),
    });

    const res = await fetch(`${baseUrl}/forge/registry`, {
      headers: { 'x-forge-key': API_KEY },
    });
    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assert.ok('containers' in body, 'response should have containers field');
    assert.ok(Array.isArray(body['containers']), 'containers should be an array');
    const containers = body['containers'] as Array<Record<string, unknown>>;
    assert.equal(containers.length, 1);
    assert.equal(containers[0]!['container_id'], VALID_CONTAINER.container_id);
  });
});

describe('POST /forge/registry/:id', () => {
  it('updates container fields', async () => {
    // Register first
    await fetch(`${baseUrl}/forge/register`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(VALID_CONTAINER),
    });

    const res = await fetch(`${baseUrl}/forge/registry/${VALID_CONTAINER.container_id}`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ host: '10.0.9.9', port: 9999 }),
    });
    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assert.equal(body['ok'], true);
    const container = body['container'] as Record<string, unknown>;
    assert.equal(container['host'], '10.0.9.9');
    assert.equal(container['port'], 9999);
    // Other fields should be unchanged
    assert.equal(container['project_name'], VALID_CONTAINER.project_name);
  });

  it('for unknown container returns 404', async () => {
    const res = await fetch(`${baseUrl}/forge/registry/nonexistent-id`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ host: '1.2.3.4' }),
    });
    assert.equal(res.status, 404);
    const body = await res.json() as Record<string, unknown>;
    const err = body['error'] as Record<string, unknown>;
    assert.ok(err !== null && typeof err === 'object');
    assert.ok('code' in err);
    assert.ok('message' in err);
  });
});

describe('DELETE /forge/registry/:id', () => {
  it('soft-deletes container (sets active=0)', async () => {
    // Register first
    await fetch(`${baseUrl}/forge/register`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(VALID_CONTAINER),
    });

    const res = await fetch(`${baseUrl}/forge/registry/${VALID_CONTAINER.container_id}`, {
      method: 'DELETE',
      headers: { 'x-forge-key': API_KEY },
    });
    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assert.equal(body['ok'], true);

    // Verify active=0 in DB (soft-delete)
    const row = rawDb.prepare('SELECT active FROM containers WHERE container_id = ?').get(VALID_CONTAINER.container_id) as { active: number } | undefined;
    assert.ok(row !== undefined, 'container should still exist in DB after soft-delete');
    assert.equal(row.active, 0, 'container should be soft-deleted (active=0)');
  });

  it('for unknown container returns 404', async () => {
    const res = await fetch(`${baseUrl}/forge/registry/no-such-container`, {
      method: 'DELETE',
      headers: { 'x-forge-key': API_KEY },
    });
    assert.equal(res.status, 404);
    const body = await res.json() as Record<string, unknown>;
    const err = body['error'] as Record<string, unknown>;
    assert.ok(err !== null && typeof err === 'object');
    assert.ok('code' in err);
    assert.ok('message' in err);
  });
});
