// Jest setupFiles entry — sets required env vars before any test module loads.
// Must be .cjs so it runs without native ESM treatment.
process.env.HARNESS_URL = process.env.HARNESS_URL || 'http://10.0.0.1:4000';
process.env.FORGE_DB_PATH = process.env.FORGE_DB_PATH || ':memory:';
process.env.FORGE_API_KEY = process.env.FORGE_API_KEY || 'test-secret';
