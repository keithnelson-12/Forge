/**
 * Config tests — verify requireEnv behaviour and that required env vars throw
 * when absent and are accepted when present. All four vars (FORGE_PORT,
 * HARNESS_URL, FORGE_DB_PATH, FORGE_API_KEY) are required with no defaults.
 *
 * Uses dynamic import inside before() so that config.ts module-level side effects
 * (which call requireEnv for all required vars) run after env vars are set.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

// requireEnv is imported from src/config.ts. Since config.ts has module-level
// side effects (reading HARNESS_URL, FORGE_DB_PATH, FORGE_API_KEY), we set
// those env vars in before() and use a dynamic import so module evaluation
// happens after the vars are in place.
let requireEnv: (name: string, defaultValue?: string) => string;

describe('requireEnv', () => {
  before(async () => {
    process.env['FORGE_PORT'] = '4100';
    process.env['HARNESS_URL'] = 'http://10.0.0.1:4000';
    process.env['FORGE_DB_PATH'] = '/data/forge.db';
    process.env['FORGE_API_KEY'] = 'test-secret';

    const mod = await import('../config.js');
    requireEnv = mod.requireEnv;
  });

  after(() => {
    delete process.env['FORGE_PORT'];
    delete process.env['HARNESS_URL'];
    delete process.env['FORGE_DB_PATH'];
    delete process.env['FORGE_API_KEY'];
  });

  it('returns the env var value when set', () => {
    process.env['_FORGE_TEST_VAR'] = 'hello-world';
    try {
      assert.equal(requireEnv('_FORGE_TEST_VAR'), 'hello-world');
    } finally {
      delete process.env['_FORGE_TEST_VAR'];
    }
  });

  it('throws when env var is empty string', () => {
    process.env['_FORGE_TEST_VAR'] = '';
    try {
      assert.throws(
        () => requireEnv('_FORGE_TEST_VAR'),
        /Missing required environment variable: _FORGE_TEST_VAR/
      );
    } finally {
      delete process.env['_FORGE_TEST_VAR'];
    }
  });

  it('throws when env var is missing', () => {
    delete process.env['_FORGE_TEST_VAR'];
    assert.throws(
      () => requireEnv('_FORGE_TEST_VAR'),
      /Missing required environment variable: _FORGE_TEST_VAR/
    );
  });

  it('returns default value when env var is missing and default is provided', () => {
    delete process.env['_FORGE_TEST_VAR'];
    assert.equal(requireEnv('_FORGE_TEST_VAR', 'fallback'), 'fallback');
  });
});

describe('config — requireEnv enforcement', () => {
  it('requireEnv throws for FORGE_PORT when missing', () => {
    delete process.env['FORGE_PORT'];
    try {
      assert.throws(
        () => requireEnv('FORGE_PORT'),
        /Missing required environment variable: FORGE_PORT/
      );
    } finally {
      process.env['FORGE_PORT'] = '4100';
    }
  });

  it('requireEnv throws for HARNESS_URL when missing', () => {
    delete process.env['HARNESS_URL'];
    try {
      assert.throws(
        () => requireEnv('HARNESS_URL'),
        /Missing required environment variable: HARNESS_URL/
      );
    } finally {
      process.env['HARNESS_URL'] = 'http://10.0.0.1:4000';
    }
  });

  it('requireEnv throws for FORGE_DB_PATH when missing', () => {
    delete process.env['FORGE_DB_PATH'];
    try {
      assert.throws(
        () => requireEnv('FORGE_DB_PATH'),
        /Missing required environment variable: FORGE_DB_PATH/
      );
    } finally {
      process.env['FORGE_DB_PATH'] = '/data/forge.db';
    }
  });

  it('requireEnv throws for FORGE_API_KEY when missing', () => {
    delete process.env['FORGE_API_KEY'];
    try {
      assert.throws(
        () => requireEnv('FORGE_API_KEY'),
        /Missing required environment variable: FORGE_API_KEY/
      );
    } finally {
      process.env['FORGE_API_KEY'] = 'test-secret';
    }
  });

  it('requireEnv throws for HARNESS_URL when empty string', () => {
    const orig = process.env['HARNESS_URL'];
    process.env['HARNESS_URL'] = '';
    try {
      assert.throws(
        () => requireEnv('HARNESS_URL'),
        /Missing required environment variable: HARNESS_URL/
      );
    } finally {
      if (orig !== undefined) process.env['HARNESS_URL'] = orig;
      else delete process.env['HARNESS_URL'];
    }
  });

  it('requireEnv returns value when all required vars are set', () => {
    process.env['FORGE_PORT'] = '4100';
    process.env['HARNESS_URL'] = 'http://10.0.0.1:4000';
    process.env['FORGE_DB_PATH'] = '/data/forge.db';
    process.env['FORGE_API_KEY'] = 'test-secret';
    assert.equal(requireEnv('FORGE_PORT'), '4100');
    assert.equal(requireEnv('HARNESS_URL'), 'http://10.0.0.1:4000');
    assert.equal(requireEnv('FORGE_DB_PATH'), '/data/forge.db');
    assert.equal(requireEnv('FORGE_API_KEY'), 'test-secret');
  });
});
