import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface ContainerRow {
  container_id: string;
  project_name: string;
  repo_url: string;
  host: string;
  port: number;
  telegram_bot_token: string;
  telegram_chat_id: string;
  registered_at: string;
  active: number;
}

export interface TaskMapRow {
  task_id: string;
  container_id: string;
  project_name: string;
  created_at: string;
}

let db: Database.Database;

export function initDatabase(dbPath: string): Database.Database {
  if (db) return db;

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
  db.exec(schema);

  return db;
}

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized — call initDatabase(dbPath) first');
  }
  return db;
}

export function getContainer(id: string): ContainerRow | undefined {
  return getDb().prepare('SELECT * FROM containers WHERE container_id = ?').get(id) as ContainerRow | undefined;
}

export function getAllContainers(): ContainerRow[] {
  return getDb().prepare('SELECT * FROM containers').all() as ContainerRow[];
}

export function getActiveContainers(): ContainerRow[] {
  return getDb().prepare('SELECT * FROM containers WHERE active = 1').all() as ContainerRow[];
}

export function upsertContainer(data: Omit<ContainerRow, 'registered_at' | 'active'> & { registered_at?: string; active?: number }): ContainerRow {
  const now = new Date().toISOString();
  const row = {
    ...data,
    registered_at: data.registered_at ?? now,
    active: data.active ?? 1,
  };
  getDb().prepare(`
    INSERT INTO containers (container_id, project_name, repo_url, host, port, telegram_bot_token, telegram_chat_id, registered_at, active)
    VALUES (@container_id, @project_name, @repo_url, @host, @port, @telegram_bot_token, @telegram_chat_id, @registered_at, @active)
    ON CONFLICT(container_id) DO UPDATE SET
      project_name = excluded.project_name,
      repo_url = excluded.repo_url,
      host = excluded.host,
      port = excluded.port,
      telegram_bot_token = excluded.telegram_bot_token,
      telegram_chat_id = excluded.telegram_chat_id,
      active = excluded.active
  `).run(row);
  return getContainer(data.container_id) as ContainerRow;
}

export function updateContainer(id: string, fields: Partial<Omit<ContainerRow, 'container_id' | 'registered_at'>>): ContainerRow | undefined {
  const current = getContainer(id);
  if (!current) return undefined;

  const updated = { ...current, ...fields };
  getDb().prepare(`
    UPDATE containers SET
      project_name = @project_name,
      repo_url = @repo_url,
      host = @host,
      port = @port,
      telegram_bot_token = @telegram_bot_token,
      telegram_chat_id = @telegram_chat_id,
      active = @active
    WHERE container_id = @container_id
  `).run(updated);
  return getContainer(id);
}

export function deleteContainer(id: string): boolean {
  const result = getDb().prepare('UPDATE containers SET active = 0 WHERE container_id = ?').run(id);
  return result.changes > 0;
}

export function mapTask(taskId: string, containerId: string, projectName: string): void {
  getDb().prepare(`
    INSERT INTO task_map (task_id, container_id, project_name, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(task_id) DO NOTHING
  `).run(taskId, containerId, projectName, new Date().toISOString());
}

export function getTaskContainer(taskId: string): TaskMapRow | undefined {
  return getDb().prepare('SELECT * FROM task_map WHERE task_id = ?').get(taskId) as TaskMapRow | undefined;
}

export function getTasksByContainer(containerId: string): TaskMapRow[] {
  return getDb().prepare('SELECT * FROM task_map WHERE container_id = ? ORDER BY created_at DESC').all(containerId) as TaskMapRow[];
}
