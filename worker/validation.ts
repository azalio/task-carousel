// Чистые валидаторы входных данных (docs/design.md §12) — покрываются unit-тестами.
// Все сообщения — на русском, формат ошибки собирает worker/http.ts.

import { DESCRIPTION_MAX, NOTE_MAX, TITLE_MAX } from '../shared/types';

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

const ok = <T>(value: T): ValidationResult<T> => ({ ok: true, value });
const fail = (message: string): { ok: false; message: string } => ({ ok: false, message });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Название: обязательное, после trim непустое, ≤ TITLE_MAX; сохраняется trimmed.
export function validateTitle(value: unknown): ValidationResult<string> {
  if (typeof value !== 'string') return fail('Название задачи обязательно');
  const title = value.trim();
  if (title === '') return fail('Название задачи не может быть пустым');
  if (title.length > TITLE_MAX) {
    return fail(`Название задачи не может быть длиннее ${TITLE_MAX} символов`);
  }
  return ok(title);
}

// Описание: строка ≤ DESCRIPTION_MAX (не trim'ится, default '' задаёт вызывающий код).
export function validateDescription(value: unknown): ValidationResult<string> {
  if (typeof value !== 'string') return fail('Описание должно быть строкой');
  if (value.length > DESCRIPTION_MAX) {
    return fail(`Описание не может быть длиннее ${DESCRIPTION_MAX} символов`);
  }
  return ok(value);
}

// Запись прогресса: после trim непустая, ≤ NOTE_MAX; сохраняется trimmed.
export function validateNote(value: unknown): ValidationResult<string> {
  if (typeof value !== 'string') return fail('Запись прогресса не может быть пустой');
  const note = value.trim();
  if (note === '') return fail('Запись прогресса не может быть пустой');
  if (note.length > NOTE_MAX) {
    return fail(`Запись прогресса не может быть длиннее ${NOTE_MAX} символов`);
  }
  return ok(note);
}

export function validateCreateTask(
  body: unknown,
): ValidationResult<{ title: string; description: string }> {
  if (!isRecord(body)) return fail('Некорректное тело запроса');
  const title = validateTitle(body.title);
  if (!title.ok) return title;
  const description =
    body.description === undefined ? ok('') : validateDescription(body.description);
  if (!description.ok) return description;
  return ok({ title: title.value, description: description.value });
}

export function validateUpdateTask(
  body: unknown,
): ValidationResult<{ title?: string; description?: string }> {
  if (!isRecord(body)) return fail('Некорректное тело запроса');
  const patch: { title?: string; description?: string } = {};
  if (body.title !== undefined) {
    const title = validateTitle(body.title);
    if (!title.ok) return title;
    patch.title = title.value;
  }
  if (body.description !== undefined) {
    const description = validateDescription(body.description);
    if (!description.ok) return description;
    patch.description = description.value;
  }
  if (patch.title === undefined && patch.description === undefined) {
    return fail('Не переданы поля для обновления');
  }
  return ok(patch);
}

export function validateMove(body: unknown): ValidationResult<'next' | 'previous'> {
  if (isRecord(body)) {
    const direction = body.direction;
    if (direction === 'next' || direction === 'previous') return ok(direction);
  }
  return fail("Направление должно быть 'next' или 'previous'");
}

export function validateSelect(body: unknown): ValidationResult<string> {
  if (!isRecord(body) || typeof body.taskId !== 'string' || body.taskId.trim() === '') {
    return fail('Не указан идентификатор задачи');
  }
  return ok(body.taskId);
}

export function validateCheckIn(body: unknown): ValidationResult<string> {
  if (!isRecord(body)) return fail('Некорректное тело запроса');
  return validateNote(body.note);
}

export type StatusFilter = 'active' | 'completed' | 'all';

// ?status= списка задач: отсутствует → 'all'; любое другое значение → ошибка.
export function validateStatusFilter(value: string | undefined): ValidationResult<StatusFilter> {
  if (value === undefined) return ok('all');
  if (value === 'active' || value === 'completed' || value === 'all') return ok(value);
  return fail("Параметр status должен быть 'active', 'completed' или 'all'");
}
