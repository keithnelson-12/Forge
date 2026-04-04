/**
 * SSE client lifecycle tests — verify connectToHarness() state transitions
 * triggered by onopen / onerror callbacks.
 *
 * Uses an injectable EventSource factory so no module mocking is required.
 * Run with: node --import tsx/esm --test src/services/sse-client.test.ts
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { EventSourceFactory, EventSourceLike } from './sse-client.js';

// Set required env vars before importing modules that read them
process.env['FORGE_PORT'] = '4100';
process.env['HARNESS_URL'] = 'http://10.0.0.1:4000';
process.env['FORGE_DB_PATH'] = ':memory:';
process.env['FORGE_API_KEY'] = 'test-secret';

// Initialize db so db functions imported by sse-client don't throw
const dbMod = await import('../db/index.js');
dbMod.initDatabase(':memory:');

const { getSseStatus, connectToHarness } = await import('./sse-client.js');

// Fake EventSource that we can control
let fakeEs: EventSourceLike;

const fakeFactory: EventSourceFactory = (_url: string) => {
  fakeEs = {
    onopen: null,
    onerror: null,
    onmessage: null,
    addEventListener(_type: string, _handler: (event: MessageEvent) => void) {},
  };
  return fakeEs;
};

// Each test calls connectToHarness(fakeFactory) to reset state/reconnectCount
// and get a fresh fakeEs instance.

describe('getSseStatus() lifecycle', () => {
  beforeEach(() => {
    // Re-connect to reset state and reconnectCount
    connectToHarness(fakeFactory);
  });

  it('state is connecting and reconnectCount is 0 right after connectToHarness()', () => {
    const status = getSseStatus();
    assert.equal(status.state, 'connecting');
    assert.equal(status.reconnectCount, 0);
  });

  it('uptimeMs is null when not yet connected', () => {
    assert.equal(getSseStatus().uptimeMs, null);
  });

  it('state becomes connected after onopen fires', () => {
    if (fakeEs.onopen) fakeEs.onopen();
    assert.equal(getSseStatus().state, 'connected');
  });

  it('uptimeMs is a non-negative number after onopen fires', () => {
    if (fakeEs.onopen) fakeEs.onopen();
    const { uptimeMs } = getSseStatus();
    assert.equal(typeof uptimeMs, 'number');
    assert.ok((uptimeMs as number) >= 0, 'uptimeMs should be >= 0');
  });

  it('lastConnectedAt becomes a valid ISO string after onopen fires', () => {
    const before = Date.now();
    if (fakeEs.onopen) fakeEs.onopen();
    const after = Date.now();

    const { lastConnectedAt } = getSseStatus();
    assert.ok(lastConnectedAt !== null, 'lastConnectedAt should not be null after onopen');
    assert.match(lastConnectedAt as string, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    const ts = new Date(lastConnectedAt as string).getTime();
    assert.ok(ts >= before, 'lastConnectedAt should be >= time before onopen');
    assert.ok(ts <= after, 'lastConnectedAt should be <= time after onopen');
  });

  it('lastErrorAt becomes a valid ISO string after onerror fires', () => {
    if (fakeEs.onopen) fakeEs.onopen();

    const before = Date.now();
    if (fakeEs.onerror) fakeEs.onerror(new Error('connection lost'));
    const after = Date.now();

    const { lastErrorAt } = getSseStatus();
    assert.ok(lastErrorAt !== null, 'lastErrorAt should not be null after onerror');
    assert.match(lastErrorAt as string, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    const ts = new Date(lastErrorAt as string).getTime();
    assert.ok(ts >= before, 'lastErrorAt should be >= time before onerror');
    assert.ok(ts <= after, 'lastErrorAt should be <= time after onerror');
  });

  it('state becomes reconnecting and uptimeMs becomes null after onerror', () => {
    if (fakeEs.onopen) fakeEs.onopen();
    if (fakeEs.onerror) fakeEs.onerror(new Error('dropped'));

    const status = getSseStatus();
    assert.equal(status.state, 'reconnecting');
    assert.equal(status.uptimeMs, null);
  });

  it('reconnectCount is 1 after first error following a successful connect', () => {
    if (fakeEs.onopen) fakeEs.onopen();
    if (fakeEs.onerror) fakeEs.onerror(new Error('err1'));
    assert.equal(getSseStatus().reconnectCount, 1);
  });

  it('reconnectCount increments on successive errors', () => {
    if (fakeEs.onopen) fakeEs.onopen();

    if (fakeEs.onerror) fakeEs.onerror(new Error('err1'));
    assert.equal(getSseStatus().reconnectCount, 1);

    if (fakeEs.onerror) fakeEs.onerror(new Error('err2'));
    assert.equal(getSseStatus().reconnectCount, 2);

    if (fakeEs.onerror) fakeEs.onerror(new Error('err3'));
    assert.equal(getSseStatus().reconnectCount, 3);
  });

  it('reconnectCount resets to 0 after reconnecting and onopen fires again', () => {
    if (fakeEs.onopen) fakeEs.onopen();
    if (fakeEs.onerror) fakeEs.onerror(new Error('disconnect'));
    assert.equal(getSseStatus().reconnectCount, 1);

    // Simulate reconnect success — onopen fires again on same instance
    if (fakeEs.onopen) fakeEs.onopen();
    assert.equal(getSseStatus().reconnectCount, 0);
    assert.equal(getSseStatus().state, 'connected');
  });
});
