// Worker Task Carousel: API под /api/* + раздача статики через ASSETS
// с security-заголовками (docs/design.md §11–13).

import { Hono } from 'hono';
import type { Context } from 'hono';
import type {
  CarouselCurrent,
  CarouselTask,
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

// Тело write-запросов читаем только с Content-Type: application/json. Это лишает
// злоумышленника «simple request» (text/plain без preflight) и заставляет браузер
// делать preflight, который отклонится отсутствием CORS-заголовков (§13, CSRF).
async function readJsonBody(
  c: Context<AppEnv>,
): Promise<{ ok: true; value: unknown } | { ok: false; message: string }> {
  const contentType = c.req.header('Content-Type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    return { ok: false, message: 'Ожидается application/json' };
  }
  try {
    return { ok: true, value: await c.req.json() };
  } catch {
    return { ok: false, message: 'Некорректное тело запроса' };
  }
}

// Сборка ответа CarouselCurrent для уже известного текущего id.
async function buildCurrent(
  db: D1Database,
  sortedActive: readonly TaskRow[],
  currentId: string | null,
): Promise<CarouselCurrent> {
  if (currentId === null) {
    return {
      task: null,
      previousTask: null,
      nextTask: null,
      currentIndex: 0,
      total: sortedActive.length,
    };
  }
  const index = currentIndexOf(sortedActive, currentId);
  const previousIndex = (index - 1 + sortedActive.length) % sortedActive.length;
  const nextIndex = (index + 1) % sortedActive.length;
  const rows =
    sortedActive.length > 1
      ? [sortedActive[index], sortedActive[previousIndex], sortedActive[nextIndex]]
      : [sortedActive[index]];

  // Буфер всегда ограничен тремя уникальными карточками. Для двух задач previous
  // и next совпадают, поэтому последнюю запись читаем только один раз.
  const uniqueRows = [...new Map(rows.map((row) => [row.id, row])).values()];
  const taskEntries = await Promise.all(
    uniqueRows.map(async (row) => {
      const last = await getLastProgress(db, row.id);
      const task: CarouselTask = {
        id: row.id,
        title: row.title,
        description: row.description,
        lastProgress: last ? { note: last.note, createdAt: last.created_at } : null,
      };
      return [row.id, task] as const;
    }),
  );
  const tasksById = new Map(taskEntries);

  return {
    task: tasksById.get(sortedActive[index].id) ?? null,
    previousTask:
      sortedActive.length > 1 ? (tasksById.get(sortedActive[previousIndex].id) ?? null) : null,
    nextTask:
      sortedActive.length > 1 ? (tasksById.get(sortedActive[nextIndex].id) ?? null) : null,
    currentIndex: index,
    total: sortedActive.length,
  };
}

// Разрешение текущей задачи (§7): сохранённая активна → она; была завершена →
// СЛЕДУЮЩАЯ активная после её позиции (позиция в карусели сохраняется); строки нет
// вовсе / активных нет → первая активная / null. Если результат отличается от
// сохранённого — персистим.
async function resolveAndPersistCurrent(
  db: D1Database,
  email: string,
): Promise<{ active: TaskRow[]; currentId: string | null }> {
  const active = sortActive(await getActiveTasks(db, email));
  const savedId = await getSavedCurrentTaskId(db, email);
  const currentId = await resolveCurrentWithNext(db, email, active, savedId);
  if (currentId !== savedId) {
    await setCurrentTaskStmt(db, email, currentId, Date.now()).run();
  }
  return { active, currentId };
}

// Обёртка над чистой resolveCurrentId (её сигнатуру не трогаем — на ней unit-тесты):
// если сохранённая задача не среди активных, потому что была завершена, выбираем
// следующую по позиции через nextAfterComplete вместо возврата к первой (§7).
async function resolveCurrentWithNext(
  db: D1Database,
  email: string,
  active: readonly TaskRow[],
  savedId: string | null,
): Promise<string | null> {
  const resolved = resolveCurrentId(active, savedId);
  // resolved === savedId → сохранённая всё ещё активна; активных нет → null;
  // savedId отсутствует → «следующей после завершённой» нет смысла искать.
  if (resolved === savedId || savedId === null || active.length === 0) {
    return resolved;
  }
  // savedId задан, но выпал из активных: завершён → следующая по позиции;
  // строки нет вовсе (или иная причина) → первая активная (resolved).
  const saved = await getTask(db, email, savedId);
  if (saved && saved.status === 'completed') {
    return nextAfterComplete(active, saved.position);
  }
  return resolved;
}

// ---- Middleware ----

// Заголовки для всех ответов API (в т.ч. ошибок авторизации).
app.use('/api/*', async (c, next) => {
  await next();
  setApiResponseHeaders(c.res.headers);
});

// CSRF-защита мутирующих ручек (§13): cookie CF_Authorization у Access ходит
// SameSite=None, т.е. отправляется и в cross-site запросах. Отклоняем write, если
// браузер помечает его как межсайтовый. Не-браузерные вызовы (нет ни Sec-Fetch-Site,
// ни Origin — curl, тесты) пропускаем.
const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
app.use('/api/*', async (c, next) => {
  if (MUTATING_METHODS.has(c.req.method)) {
    const secFetchSite = c.req.header('Sec-Fetch-Site');
    if (secFetchSite !== undefined) {
      if (secFetchSite !== 'same-origin' && secFetchSite !== 'none') {
        return jsonError(c, 403, 'INVALID_TOKEN', 'Межсайтовый запрос отклонён');
      }
    } else {
      const origin = c.req.header('Origin');
      if (origin !== undefined && origin !== new URL(c.req.url).origin) {
        return jsonError(c, 403, 'INVALID_TOKEN', 'Межсайтовый запрос отклонён');
      }
    }
  }
  await next();
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
  if (!body.ok) return jsonError(c, 400, 'VALIDATION_ERROR', body.message);
  const parsed = validateCreateTask(body.value);
  if (!parsed.ok) return jsonError(c, 400, 'VALIDATION_ERROR', parsed.message);

  const email = c.get('userEmail');
  const now = Date.now();
  // В конец карусели; позиция вычисляется атомарно внутри INSERT (§4.3, §7).
  const row = await insertTaskStmt(c.env.DB, {
    id: crypto.randomUUID(),
    user_email: email,
    title: parsed.value.title,
    description: parsed.value.description,
    created_at: now,
    updated_at: now,
  }).first<TaskRow>();
  if (!row) return jsonError(c, 500, 'INTERNAL_ERROR', 'Не удалось создать задачу');
  return c.json(toTask(row), 201);
});

app.patch('/api/tasks/:taskId', async (c) => {
  const email = c.get('userEmail');
  const task = await getTask(c.env.DB, email, c.req.param('taskId'));
  if (!task) return jsonError(c, 404, 'NOT_FOUND', 'Задача не найдена');

  const body = await readJsonBody(c);
  if (!body.ok) return jsonError(c, 400, 'VALIDATION_ERROR', body.message);
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
  if (!body.ok) return jsonError(c, 400, 'VALIDATION_ERROR', body.message);
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
  if (!body.ok) return jsonError(c, 400, 'VALIDATION_ERROR', body.message);
  const selected = validateSelect(body.value);
  if (!selected.ok) return jsonError(c, 400, 'VALIDATION_ERROR', selected.message);

  const db = c.env.DB;
  const email = c.get('userEmail');
  const task = await getTask(db, email, selected.value);
  if (!task) return jsonError(c, 404, 'NOT_FOUND', 'Задача не найдена');

  // Снапшот активных читаем ДО переключения и валидируем выбранный id по нему:
  // задачу могли завершить в другой вкладке между getTask и getActiveTasks —
  // тогда её нет в снапшоте и buildCurrent показал бы чужую (§7, гонка).
  const active = sortActive(await getActiveTasks(db, email));
  if (!active.some((t) => t.id === task.id)) {
    return jsonError(c, 409, 'CONFLICT', 'Нельзя открыть завершённую задачу');
  }

  await setCurrentTaskStmt(db, email, task.id, Date.now()).run();
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
  if (!body.ok) return jsonError(c, 400, 'VALIDATION_ERROR', body.message);
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
  // Условная вставка: строка появится, только если задача всё ещё active. Задачу
  // могли завершить в другой вкладке между проверкой статуса и записью (TOCTOU) —
  // тогда changes=0, отвечаем 409 и НЕ трогаем карусель (§5).
  const insertResult = await insertProgressStmt(db, entryRow).run();
  if (insertResult.meta.changes === 0) {
    return jsonError(c, 409, 'CONFLICT', 'Задача уже завершена');
  }

  // Карусель переключаем только после подтверждённой записи прогресса.
  const active = sortActive(await getActiveTasks(db, email));
  const nextId = nextAfterCheckIn(active, task.id);
  await setCurrentTaskStmt(db, email, nextId, now).run();

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
  // В конец карусели (§6); позиция вычисляется атомарно внутри UPDATE. Текущую
  // задачу не переключаем.
  const reopened = await reopenTaskStmt(db, email, task.id, now).first<TaskRow>();
  if (!reopened) return jsonError(c, 500, 'INTERNAL_ERROR', 'Не удалось вернуть задачу');

  const { active, currentId } = await resolveAndPersistCurrent(db, email);
  const response: ReopenResponse = {
    task: toTask(reopened),
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

// Всё остальное — статика через ASSETS с security-заголовками (§13). В dev (наличие
// DEV_AUTH_EMAIL, как в auth.ts) отдаём CSP, совместимую с Vite HMR; в prod — строгую.
app.all('*', async (c) => {
  const devEmail = c.env.DEV_AUTH_EMAIL;
  const isDev = devEmail !== undefined && devEmail.trim() !== '';
  return withAssetSecurityHeaders(await c.env.ASSETS.fetch(c.req.raw), isDev);
});

app.onError((err, c) => {
  // Детали наружу не отдаём; тексты записей и JWT сюда не попадают.
  console.error('Unhandled error:', err instanceof Error ? (err.stack ?? err.message) : String(err));
  const res = jsonError(c, 500, 'INTERNAL_ERROR', 'Внутренняя ошибка сервера');
  setApiResponseHeaders(res.headers);
  return res;
});

export default { fetch: app.fetch } satisfies ExportedHandler<Env>;
