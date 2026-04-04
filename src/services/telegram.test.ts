import { test, describe, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { ContainerRow } from '../db/index.js';

const CONTAINER: ContainerRow = {
  container_id: 'my-container',
  project_name: 'My Project',
  repo_url: 'https://github.com/org/repo',
  host: '10.0.0.5',
  port: 8080,
  telegram_bot_token: 'bot999:TOKEN',
  telegram_chat_id: '-100987654321',
  registered_at: '2026-01-01T00:00:00.000Z',
  active: 1,
};

let capturedCalls: Array<{ url: string; body: Record<string, unknown> }> = [];

// Intercept fetch globally
const originalFetch = global.fetch;

beforeEach(() => {
  capturedCalls = [];
  global.fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse((init?.body as string) ?? '{}') as Record<string, unknown>;
    capturedCalls.push({ url: String(url), body });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('telegram notification formatting', () => {
  test('notifyComplete sends correct message format', async () => {
    const { notifyComplete } = await import('./telegram.js');
    await notifyComplete(CONTAINER, 'task-123');

    assert.equal(capturedCalls.length, 1);
    const call = capturedCalls[0];
    assert.ok(call.url.includes('bot999:TOKEN'));
    assert.ok(call.url.includes('sendMessage'));
    assert.equal(call.body['chat_id'], '-100987654321');
    assert.equal(call.body['text'], '✅ My Project — RELEASE READY | Task: task-123');
  });

  test('notifyBlocked sends correct message format', async () => {
    const { notifyBlocked } = await import('./telegram.js');
    await notifyBlocked(CONTAINER, 'task-456', 'test-gate', 'tests failed');

    assert.equal(capturedCalls.length, 1);
    assert.equal(capturedCalls[0].body['text'], '🚫 My Project — BLOCKED: test-gate — tests failed | Task: task-456');
  });

  test('notifyCanceled sends correct message format', async () => {
    const { notifyCanceled } = await import('./telegram.js');
    await notifyCanceled(CONTAINER, 'task-789');

    assert.equal(capturedCalls.length, 1);
    assert.equal(capturedCalls[0].body['text'], '⛔ My Project — CANCELED | Task: task-789');
  });

  test('notifyEmergencyStop sends to all containers', async () => {
    const { notifyEmergencyStop } = await import('./telegram.js');
    const CONTAINER_2: ContainerRow = {
      ...CONTAINER,
      container_id: 'container-2',
      project_name: 'Other Project',
      telegram_bot_token: 'bot888:OTHERTOKEN',
      telegram_chat_id: '-100111222333',
    };

    await notifyEmergencyStop([CONTAINER, CONTAINER_2]);

    assert.equal(capturedCalls.length, 2);
    for (const call of capturedCalls) {
      assert.equal(call.body['text'], '🛑 ALL RUNS STOPPED — emergency stop activated');
    }
    // Each call goes to the correct bot
    const urls = capturedCalls.map((c) => c.url);
    assert.ok(urls.some((u) => u.includes('bot999:TOKEN')));
    assert.ok(urls.some((u) => u.includes('bot888:OTHERTOKEN')));
  });

  test('notification failure is swallowed — does not throw', async () => {
    global.fetch = async () => {
      throw new Error('network failure');
    };
    const { notifyComplete } = await import('./telegram.js');
    // Should not throw
    await assert.doesNotReject(() => notifyComplete(CONTAINER, 'task-fail'));
  });

  test('non-200 response is logged but does not throw', async () => {
    global.fetch = async () => new Response('Unauthorized', { status: 401 });
    const { notifyComplete } = await import('./telegram.js');
    await assert.doesNotReject(() => notifyComplete(CONTAINER, 'task-401'));
  });
});
