-- Схема из docs/design.md §10. Все времена — Unix timestamp в миллисекундах.

CREATE TABLE users (
    email TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
);

CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    user_email TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK (status IN ('active', 'completed')),
    position INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER,
    FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE
);

CREATE TABLE progress_entries (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    user_email TEXT NOT NULL,
    note TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE
);

CREATE TABLE user_carousel_state (
    user_email TEXT PRIMARY KEY,
    current_task_id TEXT,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE,
    FOREIGN KEY (current_task_id) REFERENCES tasks(id) ON DELETE SET NULL
);

CREATE INDEX idx_tasks_user_status_position
ON tasks(user_email, status, position);

CREATE INDEX idx_progress_task_created
ON progress_entries(task_id, created_at DESC);

CREATE INDEX idx_progress_user_created
ON progress_entries(user_email, created_at DESC);
