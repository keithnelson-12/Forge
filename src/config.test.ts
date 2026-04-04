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

    const mod = await import('./config.js');
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
