import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase, upsertContainer, mapTask } from '../db/index.js';

// Set required env vars before config is loaded
process.env['FORGE_PORT'] = '4100';
process.env['HARNESS_URL'] = 'http://10.0.0.1:4000';
process.env['FORGE_DB_PATH'] = ':memory:';
process.env['FORGE_API_KEY'] = 'test-key';

// Initialize in-memory DB
initDatabase(':memory:');

const CONTAINER = {
  container_id: 'sse-test-container',
  project_name: 'SSE Test Project',
  repo_url: 'https://github.com/org/sse-repo',
  host: '10.0.0.10',
  port: 8000,
  telegram_bot_token: 'bot555:SSETOKEN',
  telegram_chat_id: '-100555666777',
};

upsertContainer(CONTAINER);
mapTask('sse-task-001', 'sse-test-container', 'SSE Test Project');

let telegramCalls: Array<{ url: string; body: Record<string, unknown> }> = [];

// Mock global fetch to intercept Telegram calls
const originalFetch = global.fetch;
global.fetch = async (url: string | URL | Request, init?: RequestInit) => {
  const body = JSON.parse((init?.body as string) ?? '{}') as Record<string, unknown>;
  telegramCalls.push({ url: String(url), body });
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};

const { handleEvent, getSseStatus } = await import('./sse-client.js');

describe('getSseStatus() — shape and field types', () => {
  test('returns connected field as boolean', () => {
    const status = getSseStatus();
    assert.equal(typeof status.connected, 'boolean');
  });

  test('returns reconnectAttempts field as number', () => {
    const status = getSseStatus();
    assert.equal(typeof status.reconnectAttempts, 'number');
  });

  test('returns state as a valid ConnectionState string', () => {
    const status = getSseStatus();
    const validStates = ['connecting', 'connected', 'reconnecting'];
    assert.ok(validStates.includes(status.state), `unexpected state: ${status.state}`);
  });

  test('returns lastConnectedAt as null or ISO string', () => {
    const status = getSseStatus();
    if (status.lastConnectedAt !== null) {
      assert.match(status.lastConnectedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    } else {
      assert.equal(status.lastConnectedAt, null);
    }
  });

  test('returns lastErrorAt as null or ISO string', () => {
    const status = getSseStatus();
    if (status.lastErrorAt !== null) {
      assert.match(status.lastErrorAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    } else {
      assert.equal(status.lastErrorAt, null);
    }
  });

  test('returns uptimeMs as null or non-negative number', () => {
    const status = getSseStatus();
    if (status.uptimeMs !== null) {
      assert.equal(typeof status.uptimeMs, 'number');
      assert.ok(status.uptimeMs >= 0, 'uptimeMs should be non-negative');
    } else {
      assert.equal(status.uptimeMs, null);
    }
  });

  test('getSseStatus starts disconnected with lastConnectedAt null', () => {
    const status = getSseStatus();
    assert.equal(status.connected, false);
    assert.equal(typeof status.reconnectAttempts, 'number');
    assert.equal(status.lastConnectedAt, null);
    assert.equal(status.uptimeMs, null);
  });
});

describe('handleEvent — SSE event routing', () => {
  beforeEach(() => {
    telegramCalls = [];
  });

  test('task:completed routes to notifyComplete for mapped task', async () => {
    handleEvent('task:completed', JSON.stringify({ type: 'task:completed', taskId: 'sse-task-001' }));
    // Give async notification a tick to complete
    await new Promise((r) => setImmediate(r));
    assert.equal(telegramCalls.length, 1);
    assert.ok((telegramCalls[0].body['text'] as string).includes('RELEASE READY'));
    assert.ok((telegramCalls[0].body['text'] as string).includes('sse-task-001'));
  });

  test('task:failed routes to notifyBlocked with gate and reason', async () => {
    handleEvent('task:failed', JSON.stringify({
      type: 'task:failed',
      taskId: 'sse-task-001',
      payload: { gate: 'unit-tests', reason: 'assertion failed' },
    }));
    await new Promise((r) => setImmediate(r));
    assert.equal(telegramCalls.length, 1);
    assert.ok((telegramCalls[0].body['text'] as string).includes('BLOCKED: unit-tests'));
    assert.ok((telegramCalls[0].body['text'] as string).includes('assertion failed'));
  });

  test('task:canceled routes to notifyCanceled', async () => {
    handleEvent('task:canceled', JSON.stringify({ type: 'task:canceled', taskId: 'sse-task-001' }));
    await new Promise((r) => setImmediate(r));
    assert.equal(telegramCalls.length, 1);
    assert.ok((telegramCalls[0].body['text'] as string).includes('CANCELED'));
  });

  test('task event for unmapped task sends no notification', async () => {
    handleEvent('task:completed', JSON.stringify({ type: 'task:completed', taskId: 'unknown-task-xyz' }));
    await new Promise((r) => setImmediate(r));
    assert.equal(telegramCalls.length, 0);
  });

  test('task event with no taskId sends no notification', async () => {
    handleEvent('task:completed', JSON.stringify({ type: 'task:completed' }));
    await new Promise((r) => setImmediate(r));
    assert.equal(telegramCalls.length, 0);
  });

  test('invalid JSON data is handled gracefully', () => {
    // Should not throw
    assert.doesNotThrow(() => handleEvent('task:completed', 'not-json'));
  });

  test('orchestrator:emergency_stop notifies all active containers', async () => {
    handleEvent('orchestrator:emergency_stop', JSON.stringify({ type: 'orchestrator:emergency_stop' }));
    await new Promise((r) => setImmediate(r));
    assert.ok(telegramCalls.length >= 1);
    assert.ok((telegramCalls[0].body['text'] as string).includes('ALL RUNS STOPPED'));
  });
});
