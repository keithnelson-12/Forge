import dotenv from 'dotenv';
dotenv.config();

function requireEnv(name: string, defaultValue?: string): string {
  const val = process.env[name];
  if (val !== undefined && val !== '') return val;
  if (defaultValue !== undefined) return defaultValue;
  throw new Error(`Missing required environment variable: ${name}`);
}

export const config = {
  port: parseInt(process.env['FORGE_PORT'] ?? '4100', 10),
  harnessUrl: requireEnv('HARNESS_URL', 'http://localhost:4000'),
  dbPath: requireEnv('FORGE_DB_PATH', './forge.db'),
  apiKey: requireEnv('FORGE_API_KEY', 'dev-key'),
} as const;

export type Config = typeof config;
