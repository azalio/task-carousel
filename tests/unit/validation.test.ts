// Unit-тесты валидаторов (worker/validation.ts) по docs/design.md §12.

import { describe, expect, it } from 'vitest';
import { DESCRIPTION_MAX, NOTE_MAX, TITLE_MAX } from '../../shared/types';
import {
  validateCheckIn,
  validateCreateTask,
  validateDescription,
  validateMove,
  validateNote,
  validateSelect,
  validateStatusFilter,
  validateTitle,
  validateUpdateTask,
} from '../../worker/validation';

describe('validateTitle', () => {
  it('обязателен: не-строка (отсутствует) → ошибка', () => {
    expect(validateTitle(undefined).ok).toBe(false);
    expect(validateTitle(null).ok).toBe(false);
    expect(validateTitle(42).ok).toBe(false);
  });

  it('пустой и пробельный после trim → ошибка', () => {
    expect(validateTitle('').ok).toBe(false);
    expect(validateTitle('   \n\t ').ok).toBe(false);
  });

  it('ровно 200 символов — ок', () => {
    const result = validateTitle('a'.repeat(TITLE_MAX));
    expect(result).toEqual({ ok: true, value: 'a'.repeat(TITLE_MAX) });
  });

  it('201 символ → ошибка', () => {
    expect(validateTitle('a'.repeat(TITLE_MAX + 1)).ok).toBe(false);
  });

  it('сохраняется trimmed-значение', () => {
    expect(validateTitle('  Доклад  ')).toEqual({ ok: true, value: 'Доклад' });
  });

  it('лимит применяется ПОСЛЕ trim: 200 значащих символов в пробелах — ок', () => {
    const result = validateTitle(`  ${'a'.repeat(TITLE_MAX)}  `);
    expect(result).toEqual({ ok: true, value: 'a'.repeat(TITLE_MAX) });
  });
});

describe('validateDescription', () => {
  it('не-строка → ошибка', () => {
    expect(validateDescription(42).ok).toBe(false);
  });

  it('5000 символов — ок, 5001 → ошибка', () => {
    expect(validateDescription('d'.repeat(DESCRIPTION_MAX)).ok).toBe(true);
    expect(validateDescription('d'.repeat(DESCRIPTION_MAX + 1)).ok).toBe(false);
  });

  it('пустая строка допустима', () => {
    expect(validateDescription('')).toEqual({ ok: true, value: '' });
  });
});

describe('validateNote', () => {
  it('не-строка / пустая / пробельная → ошибка', () => {
    expect(validateNote(undefined).ok).toBe(false);
    expect(validateNote('').ok).toBe(false);
    expect(validateNote(' \n\t ').ok).toBe(false);
  });

  it('5000 символов — ок, 5001 → ошибка', () => {
    expect(validateNote('n'.repeat(NOTE_MAX)).ok).toBe(true);
    expect(validateNote('n'.repeat(NOTE_MAX + 1)).ok).toBe(false);
  });

  it('сохраняется trimmed-значение', () => {
    expect(validateNote('  сделал раздел  ')).toEqual({ ok: true, value: 'сделал раздел' });
  });
});

describe('validateCreateTask', () => {
  it('не-объект → ошибка', () => {
    expect(validateCreateTask(null).ok).toBe(false);
    expect(validateCreateTask('str').ok).toBe(false);
    expect(validateCreateTask([]).ok).toBe(false);
  });

  it('без title → ошибка', () => {
    expect(validateCreateTask({}).ok).toBe(false);
  });

  it("description по умолчанию — ''", () => {
    expect(validateCreateTask({ title: 'Задача' })).toEqual({
      ok: true,
      value: { title: 'Задача', description: '' },
    });
  });

  it('невалидное description → ошибка', () => {
    expect(validateCreateTask({ title: 'Задача', description: 5 }).ok).toBe(false);
  });
});

describe('validateUpdateTask', () => {
  it('патч без полей → ошибка', () => {
    expect(validateUpdateTask({}).ok).toBe(false);
  });

  it('только title / только description — ок', () => {
    expect(validateUpdateTask({ title: ' Новое ' })).toEqual({
      ok: true,
      value: { title: 'Новое' },
    });
    expect(validateUpdateTask({ description: 'Описание' })).toEqual({
      ok: true,
      value: { description: 'Описание' },
    });
  });

  it('невалидное поле → ошибка', () => {
    expect(validateUpdateTask({ title: '' }).ok).toBe(false);
    expect(validateUpdateTask({ description: 'd'.repeat(DESCRIPTION_MAX + 1) }).ok).toBe(false);
  });
});

describe('validateMove', () => {
  it("принимает только 'next' и 'previous'", () => {
    expect(validateMove({ direction: 'next' })).toEqual({ ok: true, value: 'next' });
    expect(validateMove({ direction: 'previous' })).toEqual({ ok: true, value: 'previous' });
  });

  it('другие значения и формы тела → ошибка', () => {
    expect(validateMove({ direction: 'up' }).ok).toBe(false);
    expect(validateMove({}).ok).toBe(false);
    expect(validateMove(null).ok).toBe(false);
    expect(validateMove('next').ok).toBe(false);
  });
});

describe('validateSelect', () => {
  it('непустой taskId — ок', () => {
    expect(validateSelect({ taskId: 'abc' })).toEqual({ ok: true, value: 'abc' });
  });

  it('пустой/отсутствующий/не-строка → ошибка', () => {
    expect(validateSelect({ taskId: '' }).ok).toBe(false);
    expect(validateSelect({ taskId: '   ' }).ok).toBe(false);
    expect(validateSelect({}).ok).toBe(false);
    expect(validateSelect(null).ok).toBe(false);
  });
});

describe('validateCheckIn', () => {
  it('валидная note — ок (trimmed)', () => {
    expect(validateCheckIn({ note: ' готово ' })).toEqual({ ok: true, value: 'готово' });
  });

  it('не-объект или пустая note → ошибка', () => {
    expect(validateCheckIn(null).ok).toBe(false);
    expect(validateCheckIn({ note: '  ' }).ok).toBe(false);
  });
});

describe('validateStatusFilter', () => {
  it("отсутствует → 'all'", () => {
    expect(validateStatusFilter(undefined)).toEqual({ ok: true, value: 'all' });
  });

  it('active / completed / all — ок', () => {
    expect(validateStatusFilter('active')).toEqual({ ok: true, value: 'active' });
    expect(validateStatusFilter('completed')).toEqual({ ok: true, value: 'completed' });
    expect(validateStatusFilter('all')).toEqual({ ok: true, value: 'all' });
  });

  it('любое другое значение → ошибка', () => {
    expect(validateStatusFilter('done').ok).toBe(false);
    expect(validateStatusFilter('').ok).toBe(false);
    expect(validateStatusFilter('ACTIVE').ok).toBe(false);
  });
});
