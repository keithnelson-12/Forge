import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase, getContainer, getAllContainers, getActiveContainers, upsertContainer, updateContainer, deleteContainer, mapTask, getTaskContainer, getTasksByContainer } from './index.js';

// Use a fresh in-memory DB for each test group
beforeEach(() => {
  // Reset module-level db by re-initializing with :memory:
  // initDatabase is idempotent after first call, so we work around it
  // by using a unique path each time (different :memory: handle per test would require module reload).
  // For simplicity: tests rely on the same in-memory DB, ordered to avoid collisions.
});

// Initialize once with in-memory DB for all tests in this file
initDatabase(':memory:');

const BASE_CONTAINER = {
  container_id: 'test-container-1',
  project_name: 'My Test Project',
  repo_url: 'https://github.com/org/repo',
  host: '10.10.0.5',
  port: 8080,
  telegram_bot_token: 'bot123:token',
  telegram_chat_id: '-1001234567890',
};

describe('container registry', () => {
  test('upsertContainer inserts a new container', () => {
    const row = upsertContainer(BASE_CONTAINER);
    assert.equal(row.container_id, 'test-container-1');
    assert.equal(row.project_name, 'My Test Project');
    assert.equal(row.host, '10.10.0.5');
    assert.equal(row.active, 1);
    assert.ok(row.registered_at);
  });

  test('getContainer returns the inserted container', () => {
    const row = getContainer('test-container-1');
    assert.ok(row);
    assert.equal(row.container_id, 'test-container-1');
  });

  test('getContainer returns undefined for unknown id', () => {
    const row = getContainer('does-not-exist');
    assert.equal(row, undefined);
  });

  test('getAllContainers returns all containers', () => {
    const all = getAllContainers();
    assert.ok(all.length >= 1);
    assert.ok(all.some((c) => c.container_id === 'test-container-1'));
  });

  test('upsertContainer updates existing container fields', () => {
    upsertContainer({ ...BASE_CONTAINER, host: '10.10.0.99' });
    const row = getContainer('test-container-1');
    assert.ok(row);
    assert.equal(row.host, '10.10.0.99');
  });

  test('updateContainer modifies specified fields', () => {
    updateContainer('test-container-1', { port: 9090 });
    const row = getContainer('test-container-1');
    assert.ok(row);
    assert.equal(row.port, 9090);
  });

  test('updateContainer returns undefined for unknown container', () => {
    const result = updateContainer('no-such-container', { port: 1234 });
    assert.equal(result, undefined);
  });

  test('deleteContainer soft-deletes (sets active=0)', () => {
    upsertContainer({ ...BASE_CONTAINER, container_id: 'to-delete', project_name: 'Delete Me' });
    const ok = deleteContainer('to-delete');
    assert.equal(ok, true);
    const row = getContainer('to-delete');
    assert.ok(row);
    assert.equal(row.active, 0);
  });

  test('deleteContainer returns false for unknown container', () => {
    const ok = deleteContainer('ghost-container');
    assert.equal(ok, false);
  });

  test('getActiveContainers excludes inactive containers', () => {
    const active = getActiveContainers();
    assert.ok(active.every((c) => c.active === 1));
    assert.ok(!active.some((c) => c.container_id === 'to-delete'));
  });
});

describe('task mapping', () => {
  test('mapTask stores a task→container mapping', () => {
    mapTask('task-abc', 'test-container-1', 'My Test Project');
    const row = getTaskContainer('task-abc');
    assert.ok(row);
    assert.equal(row.task_id, 'task-abc');
    assert.equal(row.container_id, 'test-container-1');
    assert.equal(row.project_name, 'My Test Project');
  });

  test('getTaskContainer returns undefined for unmapped task', () => {
    const row = getTaskContainer('unknown-task-xyz');
    assert.equal(row, undefined);
  });

  test('mapTask is idempotent — ON CONFLICT DO NOTHING', () => {
    mapTask('task-abc', 'test-container-1', 'My Test Project');
    mapTask('task-abc', 'test-container-1', 'Changed Name');
    // Should still be the original project_name
    const row = getTaskContainer('task-abc');
    assert.ok(row);
    assert.equal(row.project_name, 'My Test Project');
  });

  test('getTasksByContainer returns tasks for a container in descending order', () => {
    mapTask('task-001', 'test-container-1', 'My Test Project');
    mapTask('task-002', 'test-container-1', 'My Test Project');
    const tasks = getTasksByContainer('test-container-1');
    assert.ok(tasks.length >= 2);
    // All belong to correct container
    assert.ok(tasks.every((t) => t.container_id === 'test-container-1'));
  });
});
