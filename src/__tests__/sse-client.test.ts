/**
 * SSE client tests — verify getSseStatus() shape and field types.
 *
 * Run with: node --import tsx/esm --test src/__tests__/sse-client.test.ts
 *
 * These tests only exercise getSseStatus() without calling connectToHarness(),
 * so no EventSource mocking is required.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

// Set required env vars before any import that reads them
process.env['FORGE_PORT'] = '4100';
process.env['HARNESS_URL'] = 'http://10.0.0.1:4000';
process.env['FORGE_DB_PATH'] = ':memory:';
process.env['FORGE_API_KEY'] = 'test-secret';

// Initialize the db so that sse-client imports don't blow up if db functions are called
const dbMod = await import('../db/index.js');
dbMod.initDatabase(':memory:');

const { getSseStatus } = await import('../services/sse-client.js');

describe('getSseStatus() — shape and field types', () => {
  it('returns an object with all required fields', () => {
    const status = getSseStatus();
    assert.ok(typeof status === 'object' && status !== null, 'status should be an object');
    assert.ok('state' in status, 'should have state field');
    assert.ok('reconnectCount' in status, 'should have reconnectCount field');
    assert.ok('lastConnectedAt' in status, 'should have lastConnectedAt field');
    assert.ok('lastErrorAt' in status, 'should have lastErrorAt field');
    assert.ok('uptimeMs' in status, 'should have uptimeMs field');
  });

  it('returns state as a valid connection state string', () => {
    const { state } = getSseStatus();
    assert.ok(
      ['connecting', 'connected', 'reconnecting'].includes(state),
      `state should be a valid connection state, got: ${state}`
    );
  });

  it('returns reconnectCount as a non-negative integer', () => {
    const { reconnectCount } = getSseStatus();
    assert.equal(typeof reconnectCount, 'number');
    assert.ok(reconnectCount >= 0, 'reconnectCount should be >= 0');
    assert.ok(Number.isInteger(reconnectCount), 'reconnectCount should be an integer');
  });

  it('returns lastConnectedAt as null or string', () => {
    const { lastConnectedAt } = getSseStatus();
    assert.ok(
      lastConnectedAt === null || typeof lastConnectedAt === 'string',
      'lastConnectedAt should be null or string'
    );
  });

  it('returns lastErrorAt as null or string', () => {
    const { lastErrorAt } = getSseStatus();
    assert.ok(
      lastErrorAt === null || typeof lastErrorAt === 'string',
      'lastErrorAt should be null or string'
    );
  });

  it('returns uptimeMs as null or non-negative number', () => {
    const { uptimeMs } = getSseStatus();
    assert.ok(
      uptimeMs === null || (typeof uptimeMs === 'number' && uptimeMs >= 0),
      'uptimeMs should be null or a non-negative number'
    );
  });

  it('returns uptimeMs as null when state is not connected', () => {
    const status = getSseStatus();
    if (status.state !== 'connected') {
      assert.equal(status.uptimeMs, null);
    }
  });

  it('returns lastConnectedAt as valid ISO string when not null', () => {
    const { lastConnectedAt } = getSseStatus();
    if (lastConnectedAt !== null) {
      assert.match(lastConnectedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      // Should parse without throwing
      const d = new Date(lastConnectedAt);
      assert.ok(!isNaN(d.getTime()), 'lastConnectedAt should parse to a valid date');
    }
  });

  it('returns lastErrorAt as valid ISO string when not null', () => {
    const { lastErrorAt } = getSseStatus();
    if (lastErrorAt !== null) {
      assert.match(lastErrorAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      const d = new Date(lastErrorAt);
      assert.ok(!isNaN(d.getTime()), 'lastErrorAt should parse to a valid date');
    }
  });
});
