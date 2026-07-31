// Worker Task Carousel: API под /api/* + раздача статики через ASSETS
// с security-заголовками (docs/design.md §11–13).

import { Hono } from 'hono';
import type { Context } from 'hono';
import type {
  CarouselCurrent,
  CheckInResponse,
  CompleteResponse,
  MeResponse,
  ProgressEntry,
  ReopenResponse,
  Task,
  TaskListItem,
} from '../shared/types';
import { accessAuth } from './auth';
import {
  currentIndexOf,
  moveCurrent,
  nextAfterCheckIn,
  nextAfterComplete,
  resolveCurrentId,
  sortActive,
} from './carousel';
import {
  completeTaskStmt,
  getActiveTasks,
  getLastProgress,
  getNextActivePosition,
  getSavedCurrentTaskId,
  getTask,
  insertProgressStmt,
  insertTaskStmt,
  listProgress,
  listTaskItems,
  reopenTaskStmt,
  setCurrentTaskStmt,
  updateTaskStmt,
} from './db';
import type { ProgressEntryRow, TaskRow } from './db';
import type { AppEnv } from './env';
import { jsonError, setApiResponseHeaders, withAssetSecurityHeaders } from './http';
import {
  validateCheckIn,
  validateCreateTask,
  validateMove,
  validateSelect,
  validateStatusFilter,
  validateUpdateTask,
} from './validation';

const app = new Hono<AppEnv>();

// ---- Хелперы ----

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

async function readJsonBody(
  c: Context<AppEnv>,
): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: await c.req.json() };
  } catch {
    return { ok: false };
  }
}

// Сборка ответа CarouselCurrent для уже известного текущего id.
async function buildCurrent(
  db: D1Database,
  sortedActive: readonly TaskRow[],
  currentId: string | null,
): Promise<CarouselCurrent> {
  if (currentId === null) {
    return { task: null, currentIndex: 0, total: sortedActive.length };
  }
  const index = currentIndexOf(sortedActive, currentId);
  const row = sortedActive[index];
  const last = await getLastProgress(db, row.id);
  return {
    task: {
      id: row.id,
      title: row.title,
      description: row.description,
      lastProgress: last ? { note: last.note, createdAt: last.created_at } : null,
    },
    currentIndex: index,
    total: sortedActive.length,
  };
}

// Разрешение текущей задачи (§7): невалидная сохранённая → первая активная;
// если результат отличается от сохранённого — персистим.
async function resolveAndPersistCurrent(
  db: D1Database,
  email: string,
): Promise<{ active: TaskRow[]; currentId: string | null }> {
  const active = sortActive(await getActiveTasks(db, email));
  const savedId = await getSavedCurrentTaskId(db, email);
  const currentId = resolveCurrentId(active, savedId);
  if (currentId !== savedId) {
    await setCurrentTaskStmt(db, email, currentId, Date.now()).run();
  }
  return { active, currentId };
}

// ---- Middleware ----

// Заголовки для всех ответов API (в т.ч. ошибок авторизации).
app.use('/api/*', async (c, next) => {
  await next();
  setApiResponseHeaders(c.res.headers);
});

app.use('/api/*', accessAuth);

// ---- Пользователь ----

app.get('/api/me', (c) => {
  const body: MeResponse = { email: c.get('userEmail') };
  return c.json(body, 200);
});

// ---- Задачи ----

app.get('/api/tasks', async (c) => {
  const status = validateStatusFilter(c.req.query('status'));
  if (!status.ok) return jsonError(c, 400, 'VALIDATION_ERROR', status.message);
  const rows = await listTaskItems(c.env.DB, c.get('userEmail'), status.value);
  const items: TaskListItem[] = rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    progressCount: row.progress_count,
    lastProgressAt: row.last_progress_at,
  }));
  return c.json(items, 200);
});

app.post('/api/tasks', async (c) => {
  const body = await readJsonBody(c);
  if (!body.ok) return jsonError(c, 400, 'VALIDATION_ERROR', 'Некорректное тело запроса');
  const parsed = validateCreateTask(body.value);
  if (!parsed.ok) return jsonError(c, 400, 'VALIDATION_ERROR', parsed.message);

  const email = c.get('userEmail');
  const now = Date.now();
  const row: TaskRow = {
    id: crypto.randomUUID(),
    user_email: email,
    title: parsed.value.title,
    description: parsed.value.description,
    status: 'active',
    // В конец карусели; текущая задача не переключается (§4.3).
    position: await getNextActivePosition(c.env.DB, email),
    created_at: now,
    updated_at: now,
    completed_at: null,
  };
  await insertTaskStmt(c.env.DB, row).run();
  return c.json(toTask(row), 201);
});

app.patch('/api/tasks/:taskId', async (c) => {
  const email = c.get('userEmail');
  const task = await getTask(c.env.DB, email, c.req.param('taskId'));
  if (!task) return jsonError(c, 404, 'NOT_FOUND', 'Задача не найдена');

  const body = await readJsonBody(c);
  if (!body.ok) return jsonError(c, 400, 'VALIDATION_ERROR', 'Некорректное тело запроса');
  const parsed = validateUpdateTask(body.value);
  if (!parsed.ok) return jsonError(c, 400, 'VALIDATION_ERROR', parsed.message);

  const now = Date.now();
  await updateTaskStmt(c.env.DB, email, task.id, parsed.value, now).run();
  const updated: Task = {
    ...toTask(task),
    title: parsed.value.title ?? task.title,
    description: parsed.value.description ?? task.description,
    updatedAt: now,
  };
  return c.json(updated, 200);
});

// ---- Карусель ----

app.get('/api/carousel/current', async (c) => {
  const db = c.env.DB;
  const { active, currentId } = await resolveAndPersistCurrent(db, c.get('userEmail'));
  return c.json(await buildCurrent(db, active, currentId), 200);
});

app.post('/api/carousel/move', async (c) => {
  const body = await readJsonBody(c);
  if (!body.ok) return jsonError(c, 400, 'VALIDATION_ERROR', 'Некорректное тело запроса');
  const direction = validateMove(body.value);
  if (!direction.ok) return jsonError(c, 400, 'VALIDATION_ERROR', direction.message);

  const db = c.env.DB;
  const email = c.get('userEmail');
  const { active, currentId } = await resolveAndPersistCurrent(db, email);
  const nextId = moveCurrent(active, currentId, direction.value);
  if (nextId !== currentId) {
    await setCurrentTaskStmt(db, email, nextId, Date.now()).run();
  }
  return c.json(await buildCurrent(db, active, nextId), 200);
});

app.post('/api/carousel/select', async (c) => {
  const body = await readJsonBody(c);
  if (!body.ok) return jsonError(c, 400, 'VALIDATION_ERROR', 'Некорректное тело запроса');
  const selected = validateSelect(body.value);
  if (!selected.ok) return jsonError(c, 400, 'VALIDATION_ERROR', selected.message);

  const db = c.env.DB;
  const email = c.get('userEmail');
  const task = await getTask(db, email, selected.value);
  if (!task) return jsonError(c, 404, 'NOT_FOUND', 'Задача не найдена');
  if (task.status !== 'active') {
    return jsonError(c, 409, 'CONFLICT', 'Завершённую задачу нельзя открыть в карусели');
  }

  await setCurrentTaskStmt(db, email, task.id, Date.now()).run();
  const active = sortActive(await getActiveTasks(db, email));
  return c.json(await buildCurrent(db, active, task.id), 200);
});

// ---- Прогресс и жизненный цикл задачи ----

app.post('/api/tasks/:taskId/check-in', async (c) => {
  const db = c.env.DB;
  const email = c.get('userEmail');
  const task = await getTask(db, email, c.req.param('taskId'));
  if (!task) return jsonError(c, 404, 'NOT_FOUND', 'Задача не найдена');
  if (task.status !== 'active') return jsonError(c, 409, 'CONFLICT', 'Задача уже завершена');

  const body = await readJsonBody(c);
  if (!body.ok) return jsonError(c, 400, 'VALIDATION_ERROR', 'Некорректное тело запроса');
  const note = validateCheckIn(body.value);
  if (!note.ok) return jsonError(c, 400, 'VALIDATION_ERROR', note.message);

  const now = Date.now();
  const entryRow: ProgressEntryRow = {
    id: crypto.randomUUID(),
    task_id: task.id,
    user_email: email,
    note: note.value,
    created_at: now,
  };
  const active = sortActive(await getActiveTasks(db, email));
  const nextId = nextAfterCheckIn(active, task.id);
  await db.batch([insertProgressStmt(db, entryRow), setCurrentTaskStmt(db, email, nextId, now)]);

  const response: CheckInResponse = {
    entry: {
      id: entryRow.id,
      taskId: entryRow.task_id,
      note: entryRow.note,
      createdAt: entryRow.created_at,
    },
    current: await buildCurrent(db, active, nextId),
  };
  return c.json(response, 201);
});

app.post('/api/tasks/:taskId/complete', async (c) => {
  const db = c.env.DB;
  const email = c.get('userEmail');
  const task = await getTask(db, email, c.req.param('taskId'));
  if (!task) return jsonError(c, 404, 'NOT_FOUND', 'Задача не найдена');
  if (task.status !== 'active') return jsonError(c, 409, 'CONFLICT', 'Задача уже завершена');

  const now = Date.now();
  const active = sortActive(await getActiveTasks(db, email));
  const remaining = active.filter((t) => t.id !== task.id);
  const nextId = nextAfterComplete(remaining, task.position);
  await db.batch([completeTaskStmt(db, email, task.id, now), setCurrentTaskStmt(db, email, nextId, now)]);

  const response: CompleteResponse = {
    task: { ...toTask(task), status: 'completed', completedAt: now, updatedAt: now },
    current: await buildCurrent(db, remaining, nextId),
  };
  return c.json(response, 200);
});

app.post('/api/tasks/:taskId/reopen', async (c) => {
  const db = c.env.DB;
  const email = c.get('userEmail');
  const task = await getTask(db, email, c.req.param('taskId'));
  if (!task) return jsonError(c, 404, 'NOT_FOUND', 'Задача не найдена');
  if (task.status !== 'completed') return jsonError(c, 409, 'CONFLICT', 'Задача уже в работе');

  const now = Date.now();
  // В конец карусели (§6); текущую задачу не переключаем.
  const position = await getNextActivePosition(db, email);
  await reopenTaskStmt(db, email, task.id, position, now).run();

  const { active, currentId } = await resolveAndPersistCurrent(db, email);
  const response: ReopenResponse = {
    task: { ...toTask(task), status: 'active', completedAt: null, position, updatedAt: now },
    current: await buildCurrent(db, active, currentId),
  };
  return c.json(response, 200);
});

app.get('/api/tasks/:taskId/progress', async (c) => {
  const db = c.env.DB;
  const email = c.get('userEmail');
  const task = await getTask(db, email, c.req.param('taskId'));
  if (!task) return jsonError(c, 404, 'NOT_FOUND', 'Задача не найдена');

  const rows = await listProgress(db, email, task.id);
  const entries: ProgressEntry[] = rows.map((row) => ({
    id: row.id,
    taskId: row.task_id,
    note: row.note,
    createdAt: row.created_at,
  }));
  return c.json(entries, 200);
});

// Неизвестные /api-маршруты — 404 в едином формате, а не SPA-fallback.
app.all('/api/*', (c) => jsonError(c, 404, 'NOT_FOUND', 'Маршрут не найден'));

// Всё остальное — статика через ASSETS с security-заголовками (§13).
app.all('*', async (c) => withAssetSecurityHeaders(await c.env.ASSETS.fetch(c.req.raw)));

app.onError((err, c) => {
  // Детали наружу не отдаём; тексты записей и JWT сюда не попадают.
  console.error('Unhandled error:', err instanceof Error ? (err.stack ?? err.message) : String(err));
  const res = jsonError(c, 500, 'INTERNAL_ERROR', 'Внутренняя ошибка сервера');
  setApiResponseHeaders(res.headers);
  return res;
});

export default { fetch: app.fetch } satisfies ExportedHandler<Env>;
