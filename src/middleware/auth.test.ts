import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response, NextFunction } from 'express';

// Mock config before importing auth middleware
process.env['FORGE_PORT'] = '4100';
process.env['HARNESS_URL'] = 'http://10.0.0.1:4000';
process.env['FORGE_DB_PATH'] = ':memory:';
process.env['FORGE_API_KEY'] = 'test-secret-key';

const { authMiddleware } = await import('./auth.js');

function makeReq(headers: Record<string, string>): Request {
  return { headers } as unknown as Request;
}

function makeRes(): Response {
  return {} as Response;
}

function makeNext(): { fn: NextFunction; calledWith: unknown[] } {
  const calledWith: unknown[] = [];
  const fn: NextFunction = (arg?: unknown) => { calledWith.push(arg); };
  return { fn, calledWith };
}

describe('authMiddleware', () => {
  test('passes with valid Bearer token', () => {
    const req = makeReq({ authorization: 'Bearer test-secret-key' });
    const { fn, calledWith } = makeNext();
    authMiddleware(req, makeRes(), fn);
    assert.equal(calledWith.length, 1);
    assert.equal(calledWith[0], undefined); // next() called with no error
  });

  test('passes with valid x-forge-key header', () => {
    const req = makeReq({ 'x-forge-key': 'test-secret-key' });
    const { fn, calledWith } = makeNext();
    authMiddleware(req, makeRes(), fn);
    assert.equal(calledWith.length, 1);
    assert.equal(calledWith[0], undefined);
  });

  test('rejects with missing auth headers', () => {
    const req = makeReq({});
    const { fn, calledWith } = makeNext();
    authMiddleware(req, makeRes(), fn);
    assert.equal(calledWith.length, 1);
    const err = calledWith[0] as { statusCode?: number; code?: string };
    assert.equal(err.statusCode, 401);
    assert.equal(err.code, 'UNAUTHORIZED');
  });

  test('rejects with wrong Bearer token', () => {
    const req = makeReq({ authorization: 'Bearer wrong-key' });
    const { fn, calledWith } = makeNext();
    authMiddleware(req, makeRes(), fn);
    assert.equal(calledWith.length, 1);
    const err = calledWith[0] as { statusCode?: number; code?: string };
    assert.equal(err.statusCode, 401);
    assert.equal(err.code, 'UNAUTHORIZED');
  });

  test('rejects with wrong x-forge-key', () => {
    const req = makeReq({ 'x-forge-key': 'not-the-right-key' });
    const { fn, calledWith } = makeNext();
    authMiddleware(req, makeRes(), fn);
    assert.equal(calledWith.length, 1);
    const err = calledWith[0] as { statusCode?: number };
    assert.equal(err.statusCode, 401);
  });

  test('prefers Authorization header over x-forge-key', () => {
    // Wrong Bearer but correct x-forge-key — should fail since Authorization takes precedence
    const req = makeReq({ authorization: 'Bearer wrong-key', 'x-forge-key': 'test-secret-key' });
    const { fn, calledWith } = makeNext();
    authMiddleware(req, makeRes(), fn);
    assert.equal(calledWith.length, 1);
    const err = calledWith[0] as { statusCode?: number };
    assert.equal(err.statusCode, 401);
  });
});
