// Интеграционные тесты Worker API в workerd (@cloudflare/vitest-pool-workers)
// с реальной miniflare D1. Ожидания — docs/design.md §5–7, §11–12.
//
// Identity фиксирован binding'ом DEV_AUTH_EMAIL='test@example.com'
// (vitest.workers.config.ts), поэтому:
//  - состояние D1 чистим в beforeEach (оно сохраняется между тестами файла);
//  - изоляцию пользователей проверяем прямой вставкой чужой задачи в env.DB.

import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  ApiErrorBody,
  CarouselCurrent,
  CheckInResponse,
  CompleteResponse,
  MeResponse,
  ProgressEntry,
  ReopenResponse,
  Task,
  TaskListItem,
} from '../../shared/types';
import worker from '../../worker/index';

const USER = 'test@example.com';
const OTHER_USER = 'other@example.com';

type TestEnv = typeof env;

interface CallOptions {
  body?: unknown;
  rawBody?: string;
  env?: TestEnv;
}

async function call(method: string, path: string, options: CallOptions = {}): Promise<Response> {
  const init: RequestInit = { method };
  if (options.rawBody !== undefined) {
    init.body = options.rawBody;
    init.headers = { 'Content-Type': 'application/json' };
  } else if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(`http://example.com${path}`, init) as Parameters<typeof worker.fetch>[0],
    options.env ?? env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

async function callJson<T>(
  method: string,
  path: string,
  options: CallOptions = {},
): Promise<{ status: number; body: T }> {
  const response = await call(method, path, options);
  return { status: response.status, body: (await response.json()) as T };
}

async function createTask(title: string, description?: string): Promise<Task> {
  const { status, body } = await callJson<Task>('POST', '/api/tasks', {
    body: description === undefined ? { title } : { title, description },
  });
  expect(status).toBe(201);
  return body;
}

async function getCurrent(): Promise<CarouselCurrent> {
  const { status, body } = await callJson<CarouselCurrent>('GET', '/api/carousel/current');
  expect(status).toBe(200);
  return body;
}

function expectError(body: ApiErrorBody, code: string): void {
  expect(body.error.code).toBe(code);
  expect(typeof body.error.message).toBe('string');
  expect(body.error.message).not.toBe('');
}

// Вставка чужой задачи напрямую в D1 (identity в API фиксирован).
async function insertForeignTask(id: string, status: 'active' | 'completed' = 'active') {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO users (email, created_at, last_seen_at) VALUES (?1, ?2, ?2)
     ON CONFLICT(email) DO NOTHING`,
  )
    .bind(OTHER_USER, now)
    .run();
  await env.DB.prepare(
    `INSERT INTO tasks (id, user_email, title, description, status, position,
                        created_at, updated_at, completed_at)
     VALUES (?1, ?2, 'Чужая задача', '', ?3, 1, ?4, ?4, ?5)`,
  )
    .bind(id, OTHER_USER, status, now, status === 'completed' ? now : null)
    .run();
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(async () => {
  // Порядок: дети → родители (FK).
  await env.DB.batch([
    env.DB.prepare('DELETE FROM progress_entries'),
    env.DB.prepare('DELETE FROM user_carousel_state'),
    env.DB.prepare('DELETE FROM tasks'),
    env.DB.prepare('DELETE FROM users'),
  ]);
});

describe('GET /api/me', () => {
  it('возвращает email пользователя из auth-контекста', async () => {
    const { status, body } = await callJson<MeResponse>('GET', '/api/me');
    expect(status).toBe(200);
    expect(body).toEqual({ email: USER });
  });

  it('ответы API отдаются с nosniff и no-store', async () => {
    const response = await call('GET', '/api/me');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('auth', () => {
  it('без DEV_AUTH_EMAIL и без токена → 401 UNAUTHORIZED', async () => {
    const { status, body } = await callJson<ApiErrorBody>('GET', '/api/me', {
      env: { ...env, DEV_AUTH_EMAIL: undefined },
    });
    expect(status).toBe(401);
    expectError(body, 'UNAUTHORIZED');
  });
});

describe('POST /api/tasks', () => {
  it('создаёт задачи с позициями 1..4 (в конец карусели)', async () => {
    const tasks: Task[] = [];
    for (let i = 1; i <= 4; i++) {
      tasks.push(await createTask(`Задача ${i}`, `Описание ${i}`));
    }
    expect(tasks.map((t) => t.position)).toEqual([1, 2, 3, 4]);
    expect(tasks[0]).toMatchObject({
      title: 'Задача 1',
      description: 'Описание 1',
      status: 'active',
      completedAt: null,
    });
    expect(tasks[0].id).not.toBe('');
  });

  it('title сохраняется trimmed, description по умолчанию пустое', async () => {
    const task = await createTask('  Доклад  ');
    expect(task.title).toBe('Доклад');
    expect(task.description).toBe('');
  });

  it('пустой title → 400 VALIDATION_ERROR', async () => {
    const { status, body } = await callJson<ApiErrorBody>('POST', '/api/tasks', {
      body: { title: '   ' },
    });
    expect(status).toBe(400);
    expectError(body, 'VALIDATION_ERROR');
  });

  it('title длиннее 200 символов → 400 VALIDATION_ERROR', async () => {
    const { status, body } = await callJson<ApiErrorBody>('POST', '/api/tasks', {
      body: { title: 'a'.repeat(201) },
    });
    expect(status).toBe(400);
    expectError(body, 'VALIDATION_ERROR');
  });

  it('кривой JSON в теле → 400 VALIDATION_ERROR', async () => {
    const { status, body } = await callJson<ApiErrorBody>('POST', '/api/tasks', {
      rawBody: '{не json',
    });
    expect(status).toBe(400);
    expectError(body, 'VALIDATION_ERROR');
  });
});

describe('GET /api/carousel/current', () => {
  it('без задач → task null, total 0, currentIndex 0', async () => {
    expect(await getCurrent()).toEqual({
      task: null,
      previousTask: null,
      nextTask: null,
      currentIndex: 0,
      total: 0,
    });
  });

  it('после создания задач текущая — первая, lastProgress null', async () => {
    const t1 = await createTask('Первая');
    await createTask('Вторая');
    const current = await getCurrent();
    expect(current.total).toBe(2);
    expect(current.currentIndex).toBe(0);
    expect(current.task).toEqual({
      id: t1.id,
      title: 'Первая',
      description: '',
      lastProgress: null,
    });
  });

  it('возвращает циклических соседей с последним прогрессом', async () => {
    const t1 = await createTask('Первая');
    const t2 = await createTask('Вторая');
    const t3 = await createTask('Третья');

    const checkIn = await callJson<CheckInResponse>('POST', `/api/tasks/${t1.id}/check-in`, {
      body: { note: 'Прогресс первой' },
    });
    expect(checkIn.status).toBe(201);

    const current = await getCurrent();
    expect(current.task?.id).toBe(t2.id);
    expect(current.previousTask).toEqual({
      id: t1.id,
      title: 'Первая',
      description: '',
      lastProgress: { note: 'Прогресс первой', createdAt: checkIn.body.entry.createdAt },
    });
    expect(current.nextTask).toEqual({
      id: t3.id,
      title: 'Третья',
      description: '',
      lastProgress: null,
    });
  });
});

describe('POST /api/carousel/move', () => {
  it('next/previous циклически, с wrap на обоих краях', async () => {
    const [t1, t2, t3] = [
      await createTask('З1'),
      await createTask('З2'),
      await createTask('З3'),
    ];
    expect((await getCurrent()).task?.id).toBe(t1.id);

    const moveTo = async (direction: 'next' | 'previous') => {
      const { status, body } = await callJson<CarouselCurrent>('POST', '/api/carousel/move', {
        body: { direction },
      });
      expect(status).toBe(200);
      return body;
    };

    expect((await moveTo('next')).task?.id).toBe(t2.id);
    expect((await moveTo('next')).task?.id).toBe(t3.id);
    // wrap за последней → первая
    const wrapped = await moveTo('next');
    expect(wrapped.task?.id).toBe(t1.id);
    expect(wrapped.currentIndex).toBe(0);
    // wrap перед первой → последняя
    const back = await moveTo('previous');
    expect(back.task?.id).toBe(t3.id);
    expect(back.currentIndex).toBe(2);
    // состояние персистится
    expect((await getCurrent()).task?.id).toBe(t3.id);
  });

  it('невалидное направление → 400 VALIDATION_ERROR', async () => {
    const { status, body } = await callJson<ApiErrorBody>('POST', '/api/carousel/move', {
      body: { direction: 'sideways' },
    });
    expect(status).toBe(400);
    expectError(body, 'VALIDATION_ERROR');
  });
});

describe('POST /api/carousel/select', () => {
  it('выбор активной задачи делает её текущей', async () => {
    await createTask('З1');
    const t2 = await createTask('З2');
    const { status, body } = await callJson<CarouselCurrent>('POST', '/api/carousel/select', {
      body: { taskId: t2.id },
    });
    expect(status).toBe(200);
    expect(body.task?.id).toBe(t2.id);
    expect(body.currentIndex).toBe(1);
    expect((await getCurrent()).task?.id).toBe(t2.id);
  });

  it('несуществующая задача → 404 NOT_FOUND', async () => {
    const { status, body } = await callJson<ApiErrorBody>('POST', '/api/carousel/select', {
      body: { taskId: crypto.randomUUID() },
    });
    expect(status).toBe(404);
    expectError(body, 'NOT_FOUND');
  });

  it('завершённая задача → 409 CONFLICT', async () => {
    const t1 = await createTask('З1');
    await createTask('З2');
    await call('POST', `/api/tasks/${t1.id}/complete`);
    const { status, body } = await callJson<ApiErrorBody>('POST', '/api/carousel/select', {
      body: { taskId: t1.id },
    });
    expect(status).toBe(409);
    expectError(body, 'CONFLICT');
  });
});

describe('POST /api/tasks/:taskId/check-in', () => {
  it('201: entry сохранён, текущая сдвинулась на следующую', async () => {
    const [t1, t2] = [await createTask('З1'), await createTask('З2')];
    await createTask('З3');
    expect((await getCurrent()).task?.id).toBe(t1.id);

    const { status, body } = await callJson<CheckInResponse>(
      'POST',
      `/api/tasks/${t1.id}/check-in`,
      { body: { note: '  Сделал первый раздел  ' } },
    );
    expect(status).toBe(201);
    expect(body.entry.taskId).toBe(t1.id);
    expect(body.entry.note).toBe('Сделал первый раздел'); // trimmed
    expect(body.current.task?.id).toBe(t2.id);
    expect(body.current.currentIndex).toBe(1);
    expect(body.current.total).toBe(3);

    // Запись реально в базе.
    const progress = await callJson<ProgressEntry[]>('GET', `/api/tasks/${t1.id}/progress`);
    expect(progress.status).toBe(200);
    expect(progress.body).toHaveLength(1);
    expect(progress.body[0]).toMatchObject({
      id: body.entry.id,
      taskId: t1.id,
      note: 'Сделал первый раздел',
    });
    // Текущая персистится.
    expect((await getCurrent()).task?.id).toBe(t2.id);
  });

  it('единственная активная: текущая остаётся она же, lastProgress обновлён', async () => {
    const t1 = await createTask('Одна');
    const { status, body } = await callJson<CheckInResponse>(
      'POST',
      `/api/tasks/${t1.id}/check-in`,
      { body: { note: 'первая запись' } },
    );
    expect(status).toBe(201);
    expect(body.current.task?.id).toBe(t1.id);
    expect(body.current.total).toBe(1);
    expect(body.current.task?.lastProgress?.note).toBe('первая запись');

    const current = await getCurrent();
    expect(current.task?.id).toBe(t1.id);
    expect(current.task?.lastProgress?.note).toBe('первая запись');
  });

  it('пустая note → 400 VALIDATION_ERROR, запись не создаётся', async () => {
    const t1 = await createTask('З1');
    const { status, body } = await callJson<ApiErrorBody>(
      'POST',
      `/api/tasks/${t1.id}/check-in`,
      { body: { note: '   ' } },
    );
    expect(status).toBe(400);
    expectError(body, 'VALIDATION_ERROR');
    const progress = await callJson<ProgressEntry[]>('GET', `/api/tasks/${t1.id}/progress`);
    expect(progress.body).toHaveLength(0);
  });

  it('note длиннее 5000 символов → 400 VALIDATION_ERROR', async () => {
    const t1 = await createTask('З1');
    const { status, body } = await callJson<ApiErrorBody>(
      'POST',
      `/api/tasks/${t1.id}/check-in`,
      { body: { note: 'n'.repeat(5001) } },
    );
    expect(status).toBe(400);
    expectError(body, 'VALIDATION_ERROR');
  });
});

describe('POST /api/tasks/:taskId/complete', () => {
  it('200: задача исключена, текущей становится первая с большей позицией', async () => {
    const [t1, t2, t3] = [
      await createTask('З1'),
      await createTask('З2'),
      await createTask('З3'),
    ];
    const { status, body } = await callJson<CompleteResponse>(
      'POST',
      `/api/tasks/${t1.id}/complete`,
    );
    expect(status).toBe(200);
    expect(body.task.id).toBe(t1.id);
    expect(body.task.status).toBe('completed');
    expect(body.task.completedAt).not.toBeNull();
    expect(body.current.task?.id).toBe(t2.id);
    expect(body.current.total).toBe(2);

    const active = await callJson<TaskListItem[]>('GET', '/api/tasks?status=active');
    expect(active.body.map((t) => t.id)).toEqual([t2.id, t3.id]);
  });

  it('завершение последней по позиции → wrap на первую активную', async () => {
    const [t1, , t3] = [
      await createTask('З1'),
      await createTask('З2'),
      await createTask('З3'),
    ];
    const { body } = await callJson<CompleteResponse>('POST', `/api/tasks/${t3.id}/complete`);
    expect(body.current.task?.id).toBe(t1.id);
  });

  it('повторный complete → 409 CONFLICT', async () => {
    const t1 = await createTask('З1');
    await call('POST', `/api/tasks/${t1.id}/complete`);
    const { status, body } = await callJson<ApiErrorBody>(
      'POST',
      `/api/tasks/${t1.id}/complete`,
    );
    expect(status).toBe(409);
    expectError(body, 'CONFLICT');
  });

  it('завершение последней активной → current.task null', async () => {
    const t1 = await createTask('Единственная');
    const { body } = await callJson<CompleteResponse>('POST', `/api/tasks/${t1.id}/complete`);
    const emptyCarousel = {
      task: null,
      previousTask: null,
      nextTask: null,
      currentIndex: 0,
      total: 0,
    };
    expect(body.current).toEqual(emptyCarousel);
    expect(await getCurrent()).toEqual(emptyCarousel);
  });
});

describe('POST /api/tasks/:taskId/reopen', () => {
  it('200: задача возвращается в конец карусели', async () => {
    const [t1, t2, t3] = [
      await createTask('З1'),
      await createTask('З2'),
      await createTask('З3'),
    ];
    await call('POST', `/api/tasks/${t1.id}/complete`);

    const { status, body } = await callJson<ReopenResponse>('POST', `/api/tasks/${t1.id}/reopen`);
    expect(status).toBe(200);
    expect(body.task.status).toBe('active');
    expect(body.task.completedAt).toBeNull();
    expect(body.task.position).toBe(4); // после max(position)=3

    const active = await callJson<TaskListItem[]>('GET', '/api/tasks?status=active');
    expect(active.body.map((t) => t.id)).toEqual([t2.id, t3.id, t1.id]);
  });

  it('повторный reopen (задача уже активна) → 409 CONFLICT', async () => {
    const t1 = await createTask('З1');
    const { status, body } = await callJson<ApiErrorBody>('POST', `/api/tasks/${t1.id}/reopen`);
    expect(status).toBe(409);
    expectError(body, 'CONFLICT');
  });

  it('reopen последней завершённой возвращает карусель к жизни', async () => {
    const t1 = await createTask('Единственная');
    await call('POST', `/api/tasks/${t1.id}/complete`);
    const { body } = await callJson<ReopenResponse>('POST', `/api/tasks/${t1.id}/reopen`);
    expect(body.current.task?.id).toBe(t1.id);
    expect(body.current.total).toBe(1);
  });
});

describe('GET /api/tasks', () => {
  it('status=active: по position ASC, с progressCount/lastProgressAt', async () => {
    const [t1, t2] = [await createTask('З1'), await createTask('З2')];
    await call('POST', `/api/tasks/${t2.id}/check-in`, { body: { note: 'раз' } });
    await sleep(3);
    await call('POST', `/api/tasks/${t2.id}/check-in`, { body: { note: 'два' } });

    const { status, body } = await callJson<TaskListItem[]>('GET', '/api/tasks?status=active');
    expect(status).toBe(200);
    expect(body.map((t) => t.id)).toEqual([t1.id, t2.id]);
    expect(body[0].progressCount).toBe(0);
    expect(body[0].lastProgressAt).toBeNull();
    expect(body[1].progressCount).toBe(2);
    expect(body[1].lastProgressAt).not.toBeNull();
    // lastProgressAt — время последней (второй) записи.
    const progress = await callJson<ProgressEntry[]>('GET', `/api/tasks/${t2.id}/progress`);
    expect(body[1].lastProgressAt).toBe(progress.body[0].createdAt);
  });

  it('status=completed: по completed_at DESC', async () => {
    const [t1, t2, t3] = [
      await createTask('З1'),
      await createTask('З2'),
      await createTask('З3'),
    ];
    await call('POST', `/api/tasks/${t1.id}/complete`);
    await sleep(3);
    await call('POST', `/api/tasks/${t3.id}/complete`);

    const { body } = await callJson<TaskListItem[]>('GET', '/api/tasks?status=completed');
    expect(body.map((t) => t.id)).toEqual([t3.id, t1.id]); // позже завершённая — выше
    expect(body.every((t) => t.status === 'completed')).toBe(true);
    expect(body.every((t) => t.completedAt !== null)).toBe(true);

    const active = await callJson<TaskListItem[]>('GET', '/api/tasks?status=active');
    expect(active.body.map((t) => t.id)).toEqual([t2.id]);
  });

  it('status=all возвращает все задачи; без параметра — то же самое', async () => {
    const [t1, t2] = [await createTask('З1'), await createTask('З2')];
    await call('POST', `/api/tasks/${t1.id}/complete`);
    const all = await callJson<TaskListItem[]>('GET', '/api/tasks?status=all');
    expect(all.body.map((t) => t.id).sort()).toEqual([t1.id, t2.id].sort());
    const noParam = await callJson<TaskListItem[]>('GET', '/api/tasks');
    expect(noParam.body.map((t) => t.id)).toEqual(all.body.map((t) => t.id));
  });

  it('?status=мусор → 400 VALIDATION_ERROR', async () => {
    const { status, body } = await callJson<ApiErrorBody>('GET', '/api/tasks?status=garbage');
    expect(status).toBe(400);
    expectError(body, 'VALIDATION_ERROR');
  });
});

describe('GET /api/tasks/:taskId/progress', () => {
  it('записи возвращаются от новых к старым', async () => {
    const t1 = await createTask('З1');
    await call('POST', `/api/tasks/${t1.id}/check-in`, { body: { note: 'первая' } });
    await sleep(3);
    await call('POST', `/api/tasks/${t1.id}/check-in`, { body: { note: 'вторая' } });
    await sleep(3);
    await call('POST', `/api/tasks/${t1.id}/check-in`, { body: { note: 'третья' } });

    const { status, body } = await callJson<ProgressEntry[]>(
      'GET',
      `/api/tasks/${t1.id}/progress`,
    );
    expect(status).toBe(200);
    expect(body.map((e) => e.note)).toEqual(['третья', 'вторая', 'первая']);
    // createdAt невозрастающий.
    for (let i = 1; i < body.length; i++) {
      expect(body[i - 1].createdAt).toBeGreaterThanOrEqual(body[i].createdAt);
    }
  });

  it('несуществующая задача → 404 NOT_FOUND', async () => {
    const { status, body } = await callJson<ApiErrorBody>(
      'GET',
      `/api/tasks/${crypto.randomUUID()}/progress`,
    );
    expect(status).toBe(404);
    expectError(body, 'NOT_FOUND');
  });
});

describe('PATCH /api/tasks/:taskId', () => {
  it('обновляет title, не трогая description', async () => {
    const t1 = await createTask('Старое', 'Описание');
    const { status, body } = await callJson<Task>('PATCH', `/api/tasks/${t1.id}`, {
      body: { title: 'Новое' },
    });
    expect(status).toBe(200);
    expect(body.title).toBe('Новое');
    expect(body.description).toBe('Описание');

    const all = await callJson<TaskListItem[]>('GET', '/api/tasks?status=active');
    expect(all.body[0].title).toBe('Новое');
    expect(all.body[0].description).toBe('Описание');
  });

  it('обновляет description, не трогая title', async () => {
    const t1 = await createTask('Задача', 'Старое описание');
    const { body } = await callJson<Task>('PATCH', `/api/tasks/${t1.id}`, {
      body: { description: 'Новое описание' },
    });
    expect(body.title).toBe('Задача');
    expect(body.description).toBe('Новое описание');
  });

  it('пустой PATCH ({}) → 400 VALIDATION_ERROR', async () => {
    const t1 = await createTask('Задача');
    const { status, body } = await callJson<ApiErrorBody>('PATCH', `/api/tasks/${t1.id}`, {
      body: {},
    });
    expect(status).toBe(400);
    expectError(body, 'VALIDATION_ERROR');
  });

  it('несуществующая задача → 404 NOT_FOUND', async () => {
    const { status, body } = await callJson<ApiErrorBody>(
      'PATCH',
      `/api/tasks/${crypto.randomUUID()}`,
      { body: { title: 'Новое' } },
    );
    expect(status).toBe(404);
    expectError(body, 'NOT_FOUND');
  });
});

describe('изоляция пользователей (§7, §11)', () => {
  it('чужая задача недоступна: GET/PATCH/complete/check-in → 404', async () => {
    const foreignId = crypto.randomUUID();
    await insertForeignTask(foreignId);

    const progress = await callJson<ApiErrorBody>('GET', `/api/tasks/${foreignId}/progress`);
    expect(progress.status).toBe(404);
    expectError(progress.body, 'NOT_FOUND');

    const patch = await callJson<ApiErrorBody>('PATCH', `/api/tasks/${foreignId}`, {
      body: { title: 'Взлом' },
    });
    expect(patch.status).toBe(404);
    expectError(patch.body, 'NOT_FOUND');

    const complete = await callJson<ApiErrorBody>('POST', `/api/tasks/${foreignId}/complete`);
    expect(complete.status).toBe(404);
    expectError(complete.body, 'NOT_FOUND');

    const checkIn = await callJson<ApiErrorBody>('POST', `/api/tasks/${foreignId}/check-in`, {
      body: { note: 'не моя задача' },
    });
    expect(checkIn.status).toBe(404);
    expectError(checkIn.body, 'NOT_FOUND');
  });

  it('чужие задачи не попадают в список и карусель', async () => {
    await insertForeignTask(crypto.randomUUID());
    const mine = await createTask('Моя');

    const list = await callJson<TaskListItem[]>('GET', '/api/tasks?status=all');
    expect(list.body.map((t) => t.id)).toEqual([mine.id]);

    const current = await getCurrent();
    expect(current.total).toBe(1);
    expect(current.task?.id).toBe(mine.id);
  });
});

describe('неизвестные /api-маршруты', () => {
  it('→ 404 NOT_FOUND в едином формате, а не SPA-fallback', async () => {
    const { status, body } = await callJson<ApiErrorBody>('GET', '/api/nope');
    expect(status).toBe(404);
    expectError(body, 'NOT_FOUND');
  });
});
