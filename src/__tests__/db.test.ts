/**
 * Database tests — in-memory SQLite so no filesystem side-effects.
 *
 * Run with: node --import tsx/esm --test src/__tests__/db.test.ts
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  initDatabase,
  getContainer,
  getAllContainers,
  getActiveContainers,
  upsertContainer,
  updateContainer,
  deleteContainer,
  mapTask,
  getTaskContainer,
  getTasksByContainer,
} from '../db/index.js';

const SAMPLE_CONTAINER = {
  container_id: 'ctr-001',
  project_name: 'my-project',
  repo_url: 'https://github.com/org/repo',
  host: '10.0.0.5',
  port: 3000,
  telegram_bot_token: 'bot-token-123',
  telegram_chat_id: '-100123456',
};

let db: ReturnType<typeof initDatabase>;

before(() => {
  db = initDatabase(':memory:');
});

describe('container registry', () => {
  beforeEach(() => {
    db.exec('DELETE FROM task_map; DELETE FROM containers;');
  });

  it('upserts and retrieves a container', () => {
    const inserted = upsertContainer(SAMPLE_CONTAINER);
    assert.equal(inserted.container_id, 'ctr-001');
    assert.equal(inserted.project_name, 'my-project');
    assert.equal(inserted.active, 1);
    assert.equal(inserted.host, '10.0.0.5');
  });

  it('returns undefined for unknown container', () => {
    assert.equal(getContainer('nonexistent'), undefined);
  });

  it('upsert updates existing container on conflict', () => {
    upsertContainer(SAMPLE_CONTAINER);
    upsertContainer({ ...SAMPLE_CONTAINER, host: '10.0.0.99' });
    const result = getContainer('ctr-001');
    assert.equal(result?.host, '10.0.0.99');
  });

  it('getAllContainers returns all entries', () => {
    upsertContainer(SAMPLE_CONTAINER);
    upsertContainer({ ...SAMPLE_CONTAINER, container_id: 'ctr-002', project_name: 'other' });
    assert.equal(getAllContainers().length, 2);
  });

  it('getActiveContainers excludes inactive containers', () => {
    upsertContainer(SAMPLE_CONTAINER);
    upsertContainer({ ...SAMPLE_CONTAINER, container_id: 'ctr-002', project_name: 'other', active: 0 });
    const active = getActiveContainers();
    assert.equal(active.length, 1);
    assert.equal(active[0]!.container_id, 'ctr-001');
  });

  it('deleteContainer sets active = 0', () => {
    upsertContainer(SAMPLE_CONTAINER);
    const result = deleteContainer('ctr-001');
    assert.equal(result, true);
    assert.equal(getContainer('ctr-001')?.active, 0);
  });

  it('updateContainer modifies specific fields', () => {
    upsertContainer(SAMPLE_CONTAINER);
    const updated = updateContainer('ctr-001', { host: '192.168.1.1', port: 9000 });
    assert.equal(updated?.host, '192.168.1.1');
    assert.equal(updated?.port, 9000);
    assert.equal(updated?.project_name, 'my-project');
  });

  it('updateContainer returns undefined for nonexistent container', () => {
    assert.equal(updateContainer('nonexistent', { host: '1.2.3.4' }), undefined);
  });

  it('deleteContainer returns false for nonexistent container', () => {
    assert.equal(deleteContainer('nonexistent-ctr'), false);
  });
});

describe('task mapping', () => {
  beforeEach(() => {
    db.exec('DELETE FROM task_map; DELETE FROM containers;');
    upsertContainer(SAMPLE_CONTAINER);
  });

  it('maps a task to a container and retrieves it', () => {
    mapTask('task-abc', 'ctr-001', 'my-project');
    const mapping = getTaskContainer('task-abc');
    assert.equal(mapping?.container_id, 'ctr-001');
    assert.equal(mapping?.project_name, 'my-project');
  });

  it('returns undefined for unmapped task', () => {
    assert.equal(getTaskContainer('unknown-task'), undefined);
  });

  it('getTasksByContainer returns tasks in reverse chronological order', () => {
    // Insert with explicit timestamps spread apart to ensure ordering is deterministic
    db.exec(`INSERT INTO task_map (task_id, container_id, project_name, created_at) VALUES ('task-1', 'ctr-001', 'my-project', '2026-01-01T00:00:00.000Z')`);
    db.exec(`INSERT INTO task_map (task_id, container_id, project_name, created_at) VALUES ('task-2', 'ctr-001', 'my-project', '2026-01-02T00:00:00.000Z')`);
    const tasks = getTasksByContainer('ctr-001');
    assert.equal(tasks.length, 2);
    // Most recent first (task-2 has later timestamp)
    assert.equal(tasks[0]!.task_id, 'task-2');
    assert.equal(tasks[1]!.task_id, 'task-1');
  });

  it('duplicate mapTask insert is ignored', () => {
    mapTask('task-dup', 'ctr-001', 'my-project');
    mapTask('task-dup', 'ctr-001', 'my-project');
    assert.equal(getTasksByContainer('ctr-001').length, 1);
  });

  it('getTasksByContainer returns empty array for container with no tasks', () => {
    const tasks = getTasksByContainer('ctr-001');
    assert.equal(tasks.length, 0);
  });

  it('mapTask stores correct task_id, container_id, and project_name', () => {
    mapTask('task-xyz', 'ctr-001', 'my-project');
    const mapping = getTaskContainer('task-xyz');
    assert.ok(mapping !== undefined, 'mapping should exist');
    assert.equal(mapping.task_id, 'task-xyz');
    assert.equal(mapping.container_id, 'ctr-001');
    assert.equal(mapping.project_name, 'my-project');
  });
});
