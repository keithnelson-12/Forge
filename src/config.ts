import dotenv from 'dotenv';
dotenv.config();

export function requireEnv(name: string, defaultValue?: string): string {
  const val = process.env[name];
  if (val !== undefined && val !== '') return val;
  if (defaultValue !== undefined) return defaultValue;
  throw new Error(`Missing required environment variable: ${name}`);
}

export const config = {
  port: parseInt(requireEnv('FORGE_PORT'), 10),
  harnessUrl: requireEnv('HARNESS_URL'),
  dbPath: requireEnv('FORGE_DB_PATH'),
  apiKey: requireEnv('FORGE_API_KEY'),
} as const;

export type Config = typeof config;
