'use strict';

// Integration tests for the Express HTTP endpoints.
//
// Imports the canonical createApp factory from index.js so the real route
// wiring is exercised — no duplicate app construction in tests.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createApp } = require('../index.js');

// Minimal stub config used wherever routes need config fields.
const stubConfig = {
  containerId: 'test-container',
  forgeUrl: 'http://mock-forge',
};

// ── Helpers ────────────────────────────────────────────────────────────────

/** Make an HTTP request against a listening server. Returns { status, body }. */
function request(server, method, path, body) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      host: '127.0.0.1',
      port: addr.port,
      method,
      path,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = http.request(opts, (res) => {
      let raw = '';
      res.on('data', (chunk) => (raw += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode, body: raw });
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('GET /health', () => {
  let server;

  before(() => {
    const app = createApp({}, stubConfig);
    server = app.listen(0);
  });

  after(() => server.close());

  it('returns 200 with status ok', async () => {
    const { status, body } = await request(server, 'GET', '/health');
    assert.equal(status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.container_id, 'test-container');
    assert.equal(body.forge_url, 'http://mock-forge');
  });
});

describe('POST /harness/submit', () => {
  let server;
  let calls = [];

  before(() => {
    const mockClient = {
      submitRequest(payload) {
        calls.push(payload);
        return Promise.resolve({ status: 200, data: { task_id: 'task-123' } });
      },
    };
    const app = createApp(mockClient, stubConfig);
    server = app.listen(0);
  });

  after(() => server.close());

  it('returns 400 when description is missing', async () => {
    const { status, body } = await request(server, 'POST', '/harness/submit', {});
    assert.equal(status, 400);
    assert.match(body.error, /description/);
  });

  it('forwards payload to ForgeClient and returns result', async () => {
    calls = [];
    const { status, body } = await request(server, 'POST', '/harness/submit', {
      description: 'Build the login page',
      is_new_project: true,
    });
    assert.equal(status, 200);
    assert.equal(body.task_id, 'task-123');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].description, 'Build the login page');
    assert.equal(calls[0].is_new_project, true);
  });

  it('defaults is_new_project to false when omitted', async () => {
    calls = [];
    await request(server, 'POST', '/harness/submit', { description: 'Fix bug' });
    assert.equal(calls[0].is_new_project, false);
  });

  it('returns 502 when ForgeClient throws', async () => {
    const broken = {
      submitRequest() {
        return Promise.reject(new Error('connection refused'));
      },
    };
    const app = createApp(broken, stubConfig);
    const s = app.listen(0);
    const { status, body } = await request(s, 'POST', '/harness/submit', {
      description: 'anything',
    });
    s.close();
    assert.equal(status, 502);
    assert.match(body.error, /Forge unreachable/);
  });
});

describe('GET /harness/status', () => {
  let server;
  let lastCall;

  before(() => {
    const mockClient = {
      getStatus(taskId) {
        lastCall = { method: 'getStatus', taskId };
        return Promise.resolve({ status: 200, data: { task_id: taskId, status: 'running' } });
      },
      getLatestTask() {
        lastCall = { method: 'getLatestTask' };
        return Promise.resolve({ status: 200, data: [{ task_id: 'latest', status: 'done' }] });
      },
    };
    const app = createApp(mockClient, stubConfig);
    server = app.listen(0);
  });

  after(() => server.close());

  it('calls getStatus when taskId is provided', async () => {
    const { status, body } = await request(server, 'GET', '/harness/status/task-abc');
    assert.equal(status, 200);
    assert.equal(body.task_id, 'task-abc');
    assert.equal(lastCall.method, 'getStatus');
    assert.equal(lastCall.taskId, 'task-abc');
  });

  it('calls getLatestTask when taskId is omitted', async () => {
    const { status } = await request(server, 'GET', '/harness/status');
    assert.equal(status, 200);
    assert.equal(lastCall.method, 'getLatestTask');
  });
});

describe('GET /harness/list', () => {
  let server;

  before(() => {
    const mockClient = {
      listTasks() {
        return Promise.resolve({ status: 200, data: [{ task_id: 'a' }, { task_id: 'b' }] });
      },
    };
    const app = createApp(mockClient, stubConfig);
    server = app.listen(0);
  });

  after(() => server.close());

  it('returns task list from Forge', async () => {
    const { status, body } = await request(server, 'GET', '/harness/list');
    assert.equal(status, 200);
    assert.equal(body.length, 2);
  });
});

describe('POST /harness/cancel/:taskId', () => {
  let server;
  let cancelledId;

  before(() => {
    const mockClient = {
      cancelTask(taskId) {
        cancelledId = taskId;
        return Promise.resolve({ status: 200, data: { canceled: true } });
      },
    };
    const app = createApp(mockClient, stubConfig);
    server = app.listen(0);
  });

  after(() => server.close());

  it('passes taskId to ForgeClient.cancelTask', async () => {
    const { status, body } = await request(server, 'POST', '/harness/cancel/task-xyz');
    assert.equal(status, 200);
    assert.equal(body.canceled, true);
    assert.equal(cancelledId, 'task-xyz');
  });
});

describe('POST /harness/stop', () => {
  let server;
  let stopped;

  before(() => {
    const mockClient = {
      emergencyStop() {
        stopped = true;
        return Promise.resolve({ status: 200, data: { stopped: true } });
      },
    };
    const app = createApp(mockClient, stubConfig);
    server = app.listen(0);
  });

  after(() => server.close());

  it('calls ForgeClient.emergencyStop', async () => {
    stopped = false;
    const { status, body } = await request(server, 'POST', '/harness/stop');
    assert.equal(status, 200);
    assert.equal(body.stopped, true);
    assert.equal(stopped, true);
  });
});
