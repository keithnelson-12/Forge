/**
 * Server integration tests — verify HTTP behaviour of the Express app via
 * a real HTTP server bound to a random port (port 0).
 *
 * Run with:
 *   node --import tsx/esm --test src/server.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { Application } from 'express';

const API_KEY = 'test-server-integration-key';

let app: Application;
let server: Server;
let baseUrl: string;

describe('server integration', () => {
  before(async () => {
    // Set required env vars before any module that reads them is imported
    process.env['HARNESS_URL'] = 'http://10.0.0.1:4000';
    process.env['FORGE_DB_PATH'] = ':memory:';
    process.env['FORGE_API_KEY'] = API_KEY;
    process.env['FORGE_PORT'] = '0';

    // Initialize DB before creating the app — registry routes require it
    const { initDatabase } = await import('./db/index.js');
    initDatabase(':memory:');

    const { createApp } = await import('./server.js');
    app = createApp();

    // Bind to a random port so tests don't conflict with running services
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

  it('GET /forge/health returns 200 with {ok: true, version} without auth', async () => {
    const res = await fetch(`${baseUrl}/forge/health`);
    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assert.equal(body['ok'], true);
    assert.ok('version' in body, 'response should include version field');
  });

  it('GET /forge/registry without auth header returns 401', async () => {
    const res = await fetch(`${baseUrl}/forge/registry`);
    assert.equal(res.status, 401);
    const body = await res.json() as Record<string, unknown>;
    const err = body['error'] as Record<string, unknown>;
    assert.ok(err !== null && typeof err === 'object', 'response should have error object');
    assert.ok('code' in err, 'error should have code');
    assert.ok('message' in err, 'error should have message');
  });

  it('GET /forge/registry with valid x-forge-key header returns 200', async () => {
    const res = await fetch(`${baseUrl}/forge/registry`, {
      headers: { 'x-forge-key': API_KEY },
    });
    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assert.ok('containers' in body, 'response should have containers array');
    assert.ok(Array.isArray(body['containers']), 'containers should be an array');
  });

  it('GET /nonexistent returns 404 with structured error JSON', async () => {
    const res = await fetch(`${baseUrl}/nonexistent`);
    assert.equal(res.status, 404);
    const body = await res.json() as Record<string, unknown>;
    const err = body['error'] as Record<string, unknown>;
    assert.ok(err !== null && typeof err === 'object', 'response should have error object');
    assert.ok('code' in err, 'error should have code');
    assert.ok('message' in err, 'error should have message');
  });

  it('Error handler returns structured JSON {error: {code, message}}', async () => {
    // Use the 401 case to verify the error handler produces the required shape
    const res = await fetch(`${baseUrl}/forge/registry`);
    const body = await res.json() as Record<string, unknown>;
    const err = body['error'] as Record<string, unknown>;
    assert.ok(err !== null && typeof err === 'object', 'body.error should be an object');
    assert.equal(typeof err['code'], 'string', 'error.code should be a string');
    assert.equal(typeof err['message'], 'string', 'error.message should be a string');
  });
});
