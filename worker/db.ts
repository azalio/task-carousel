// Доступ к D1. Только parameterized queries через .prepare().bind() (§13).
// Функции *Stmt возвращают подготовленный statement — для .run() или env.DB.batch().

export interface TaskRow {
  id: string;
  user_email: string;
  title: string;
  description: string;
  status: 'active' | 'completed';
  position: number;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

export interface ProgressEntryRow {
  id: string;
  task_id: string;
  user_email: string;
  note: string;
  created_at: number;
}

export interface TaskListRow {
  id: string;
  title: string;
  description: string;
  status: 'active' | 'completed';
  position: number;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  progress_count: number;
  last_progress_at: number | null;
}

const TASK_COLUMNS =
  'id, user_email, title, description, status, position, created_at, updated_at, completed_at';

export function upsertUserStmt(db: D1Database, email: string, now: number): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO users (email, created_at, last_seen_at) VALUES (?1, ?2, ?2)
       ON CONFLICT(email) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
    )
    .bind(email, now);
}

// Активные задачи пользователя в порядке карусели (§7).
export async function getActiveTasks(db: D1Database, email: string): Promise<TaskRow[]> {
  const { results } = await db
    .prepare(
      `SELECT ${TASK_COLUMNS} FROM tasks
       WHERE user_email = ?1 AND status = 'active'
       ORDER BY position ASC, created_at ASC, id ASC`,
    )
    .bind(email)
    .all<TaskRow>();
  return results;
}

// Задача строго в пределах пользователя: чужая → null (наружу это 404, §12).
export async function getTask(
  db: D1Database,
  email: string,
  taskId: string,
): Promise<TaskRow | null> {
  return db
    .prepare(`SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ?1 AND user_email = ?2`)
    .bind(taskId, email)
    .first<TaskRow>();
}

export async function getSavedCurrentTaskId(
  db: D1Database,
  email: string,
): Promise<string | null> {
  const row = await db
    .prepare('SELECT current_task_id FROM user_carousel_state WHERE user_email = ?1')
    .bind(email)
    .first<{ current_task_id: string | null }>();
  return row?.current_task_id ?? null;
}

export function setCurrentTaskStmt(
  db: D1Database,
  email: string,
  taskId: string | null,
  now: number,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO user_carousel_state (user_email, current_task_id, updated_at)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(user_email) DO UPDATE
       SET current_task_id = excluded.current_task_id, updated_at = excluded.updated_at`,
    )
    .bind(email, taskId, now);
}

export async function getLastProgress(
  db: D1Database,
  taskId: string,
): Promise<{ note: string; created_at: number } | null> {
  return db
    .prepare(
      `SELECT note, created_at FROM progress_entries
       WHERE task_id = ?1
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
    )
    .bind(taskId)
    .first<{ note: string; created_at: number }>();
}

// Создаёт задачу, вычисляя позицию (MAX среди активных + 1) атомарно ВНУТРИ INSERT —
// без гонки read-then-write двух параллельных POST (§5, §7). Строку с реальной
// позицией возвращает через RETURNING.
export function insertTaskStmt(
  db: D1Database,
  fields: {
    id: string;
    user_email: string;
    title: string;
    description: string;
    created_at: number;
    updated_at: number;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO tasks (${TASK_COLUMNS})
       VALUES (?1, ?2, ?3, ?4, 'active',
               (SELECT COALESCE(MAX(position), 0) + 1 FROM tasks
                WHERE user_email = ?2 AND status = 'active'),
               ?5, ?6, NULL)
       RETURNING ${TASK_COLUMNS}`,
    )
    .bind(
      fields.id,
      fields.user_email,
      fields.title,
      fields.description,
      fields.created_at,
      fields.updated_at,
    );
}

// Обновляет только присланные поля; имена колонок — статический whitelist.
export function updateTaskStmt(
  db: D1Database,
  email: string,
  taskId: string,
  patch: { title?: string; description?: string },
  now: number,
): D1PreparedStatement {
  const sets: string[] = [];
  const binds: (string | number)[] = [];
  if (patch.title !== undefined) {
    sets.push('title = ?');
    binds.push(patch.title);
  }
  if (patch.description !== undefined) {
    sets.push('description = ?');
    binds.push(patch.description);
  }
  sets.push('updated_at = ?');
  binds.push(now, taskId, email);
  return db
    .prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ? AND user_email = ?`)
    .bind(...binds);
}

export function completeTaskStmt(
  db: D1Database,
  email: string,
  taskId: string,
  now: number,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE tasks SET status = 'completed', completed_at = ?1, updated_at = ?1
       WHERE id = ?2 AND user_email = ?3`,
    )
    .bind(now, taskId, email);
}

// Возвращает задачу в работу, вычисляя новую позицию (в конец активных) атомарно
// внутри UPDATE. Подзапрос MAX видит состояние ДО апдейта — строка ещё completed и
// в WHERE status='active' не попадает, поэтому позиция корректна. Строку с новой
// позицией отдаёт через RETURNING.
export function reopenTaskStmt(
  db: D1Database,
  email: string,
  taskId: string,
  now: number,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE tasks
       SET status = 'active', completed_at = NULL,
           position = (SELECT COALESCE(MAX(position), 0) + 1 FROM tasks
                       WHERE user_email = ?1 AND status = 'active'),
           updated_at = ?2
       WHERE id = ?3 AND user_email = ?1
       RETURNING ${TASK_COLUMNS}`,
    )
    .bind(email, now, taskId);
}

// Условная вставка записи прогресса: строка появляется, ТОЛЬКО если задача ещё
// active и принадлежит пользователю (TOCTOU — задачу могли завершить в другой
// вкладке между проверкой и записью, §5). meta.changes=0 сигналит о конфликте.
export function insertProgressStmt(
  db: D1Database,
  entry: ProgressEntryRow,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO progress_entries (id, task_id, user_email, note, created_at)
       SELECT ?1, id, user_email, ?2, ?3 FROM tasks
       WHERE id = ?4 AND user_email = ?5 AND status = 'active'`,
    )
    .bind(entry.id, entry.note, entry.created_at, entry.task_id, entry.user_email);
}

// История прогресса задачи, новые сверху.
export async function listProgress(
  db: D1Database,
  email: string,
  taskId: string,
): Promise<ProgressEntryRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, task_id, user_email, note, created_at FROM progress_entries
       WHERE task_id = ?1 AND user_email = ?2
       ORDER BY created_at DESC, id DESC`,
    )
    .bind(taskId, email)
    .all<ProgressEntryRow>();
  return results;
}

// Список задач с агрегатами прогресса одним запросом (без N+1):
// active — по position ASC, completed — по completed_at DESC (§4.2).
export async function listTaskItems(
  db: D1Database,
  email: string,
  status: 'active' | 'completed' | 'all',
): Promise<TaskListRow[]> {
  const { results } = await db
    .prepare(
      `SELECT
         t.id, t.title, t.description, t.status, t.position,
         t.created_at, t.updated_at, t.completed_at,
         (SELECT COUNT(*) FROM progress_entries p WHERE p.task_id = t.id) AS progress_count,
         (SELECT MAX(p.created_at) FROM progress_entries p WHERE p.task_id = t.id) AS last_progress_at
       FROM tasks t
       WHERE t.user_email = ?1 AND (?2 = 'all' OR t.status = ?2)
       ORDER BY
         CASE t.status WHEN 'active' THEN 0 ELSE 1 END,
         CASE WHEN t.status = 'active' THEN t.position END ASC,
         CASE WHEN t.status = 'completed' THEN t.completed_at END DESC,
         t.created_at ASC, t.id ASC`,
    )
    .bind(email, status)
    .all<TaskListRow>();
  return results;
}
