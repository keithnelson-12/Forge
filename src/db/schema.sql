CREATE TABLE IF NOT EXISTS containers (
  container_id TEXT PRIMARY KEY,
  project_name TEXT NOT NULL UNIQUE,
  repo_url TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  telegram_bot_token TEXT NOT NULL,
  telegram_chat_id TEXT NOT NULL,
  registered_at TEXT NOT NULL DEFAULT current_timestamp,
  active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS task_map (
  task_id TEXT PRIMARY KEY,
  project_name TEXT NOT NULL,
  container_id TEXT NOT NULL REFERENCES containers(container_id),
  created_at TEXT NOT NULL DEFAULT current_timestamp
);
