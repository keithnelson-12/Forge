import Database from 'better-sqlite3';
import { config } from './config.js';

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
  project_name: string | null;
  created_at: string;
}

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(config.dbPath);
    db.pragma('journal_mode = WAL');
    migrate(db);
  }
  return db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS containers (
      container_id TEXT PRIMARY KEY,
      project_name TEXT NOT NULL,
      repo_url TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      telegram_bot_token TEXT NOT NULL,
      telegram_chat_id TEXT NOT NULL,
      registered_at TEXT NOT NULL,
      active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS task_map (
      task_id TEXT PRIMARY KEY,
      container_id TEXT NOT NULL REFERENCES containers(container_id),
      project_name TEXT,
      created_at TEXT NOT NULL
    );
  `);
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

export function mapTask(taskId: string, containerId: string, projectName: string | null): void {
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
