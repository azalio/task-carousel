// Unit-тесты чистых хелперов фронтенда (src/lib/*) — node env,
// window.localStorage подменяется стабом.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DESCRIPTION_MAX, TITLE_MAX } from '../../shared/types';
import { clearDraft, draftKey, loadDraft, saveDraft } from '../../src/lib/drafts';
import { formatDate, formatDateTime, pluralRu } from '../../src/lib/format';
import { detectSwipe, hasNonEmptySelection, SWIPE_MIN_DX } from '../../src/lib/swipe';
import { validateTaskFields } from '../../src/lib/validate';

describe('drafts', () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('ключ черновика содержит идентификатор задачи (§5)', () => {
    expect(draftKey('task-123')).toContain('task-123');
  });

  it('у разных задач разные ключи — черновики не смешиваются', () => {
    expect(draftKey('a')).not.toBe(draftKey('b'));
  });

  it('save/load: черновик сохраняется и поднимается по id задачи', () => {
    saveDraft('t1', 'первый черновик');
    saveDraft('t2', 'второй черновик');
    expect(loadDraft('t1')).toBe('первый черновик');
    expect(loadDraft('t2')).toBe('второй черновик');
  });

  it('пустой текст удаляет черновик', () => {
    saveDraft('t1', 'текст');
    saveDraft('t1', '');
    expect(loadDraft('t1')).toBe('');
    expect(store.size).toBe(0);
  });

  it('clearDraft удаляет черновик', () => {
    saveDraft('t1', 'текст');
    clearDraft('t1');
    expect(loadDraft('t1')).toBe('');
  });

  it('без черновика возвращается пустая строка', () => {
    expect(loadDraft('nope')).toBe('');
  });

  it('недоступный localStorage не роняет вызовы', () => {
    vi.stubGlobal('window', {
      get localStorage(): Storage {
        throw new Error('SecurityError');
      },
    });
    expect(loadDraft('t1')).toBe('');
    expect(() => saveDraft('t1', 'x')).not.toThrow();
    expect(() => clearDraft('t1')).not.toThrow();
  });
});

describe('detectSwipe', () => {
  it('порог 48px: |dx| <= 48 — не свайп', () => {
    expect(SWIPE_MIN_DX).toBe(48);
    expect(detectSwipe(48, 0)).toBeNull();
    expect(detectSwipe(-48, 0)).toBeNull();
    expect(detectSwipe(49, 0)).toBe('right');
    expect(detectSwipe(-49, 0)).toBe('left');
  });

  it('горизонтальность: |dx| должен превышать 2|dy|', () => {
    expect(detectSwipe(100, 50, 48)).toBeNull(); // 100 <= 2*50 — скролл
    expect(detectSwipe(100, 49, 48)).toBe('right');
    expect(detectSwipe(-100, 60, 48)).toBeNull();
    expect(detectSwipe(-100, -49, 48)).toBe('left');
  });

  it('направления: dx < 0 — left, dx > 0 — right', () => {
    expect(detectSwipe(-120, 10)).toBe('left');
    expect(detectSwipe(120, -10)).toBe('right');
  });

  it('кастомный порог применяется', () => {
    expect(detectSwipe(30, 0, 20)).toBe('right');
    expect(detectSwipe(20, 0, 20)).toBeNull();
  });
});

describe('hasNonEmptySelection', () => {
  it('null или свёрнутое выделение → false, активное → true', () => {
    expect(hasNonEmptySelection(null)).toBe(false);
    expect(hasNonEmptySelection({ isCollapsed: true })).toBe(false);
    expect(hasNonEmptySelection({ isCollapsed: false })).toBe(true);
  });
});

describe('formatDateTime / formatDate', () => {
  // 12:00 UTC — дата одинакова во всех реальных часовых поясах.
  const ts = Date.UTC(2026, 2, 5, 12, 0, 0); // 5 марта 2026

  it('formatDateTime: русская дата и время ЧЧ:ММ', () => {
    const text = formatDateTime(ts);
    expect(text).toContain('2026');
    expect(text).toMatch(/мар/);
    expect(text).toMatch(/\d{2}:\d{2}/);
  });

  it('formatDate: дата без времени', () => {
    const text = formatDate(ts);
    expect(text).toContain('2026');
    expect(text).not.toMatch(/\d{2}:\d{2}/);
  });
});

describe('pluralRu', () => {
  const forms: [string, string, string] = ['запись', 'записи', 'записей'];

  it('1, 21, 101 → запись', () => {
    expect(pluralRu(1, forms)).toBe('запись');
    expect(pluralRu(21, forms)).toBe('запись');
    expect(pluralRu(101, forms)).toBe('запись');
  });

  it('2–4, 22–24 → записи', () => {
    expect(pluralRu(2, forms)).toBe('записи');
    expect(pluralRu(3, forms)).toBe('записи');
    expect(pluralRu(4, forms)).toBe('записи');
    expect(pluralRu(23, forms)).toBe('записи');
  });

  it('0, 5–20, 11–14, 25+ → записей', () => {
    expect(pluralRu(0, forms)).toBe('записей');
    expect(pluralRu(5, forms)).toBe('записей');
    expect(pluralRu(11, forms)).toBe('записей');
    expect(pluralRu(12, forms)).toBe('записей');
    expect(pluralRu(14, forms)).toBe('записей');
    expect(pluralRu(19, forms)).toBe('записей');
    expect(pluralRu(111, forms)).toBe('записей');
  });
});

describe('validateTaskFields', () => {
  it('валидные поля → нет ошибок', () => {
    expect(validateTaskFields('Задача', 'Описание')).toEqual({});
  });

  it('пустое/пробельное название → ошибка title', () => {
    expect(validateTaskFields('', '').title).toBeDefined();
    expect(validateTaskFields('   ', '').title).toBeDefined();
  });

  it('название: 200 — ок, 201 → ошибка', () => {
    expect(validateTaskFields('a'.repeat(TITLE_MAX), '').title).toBeUndefined();
    expect(validateTaskFields('a'.repeat(TITLE_MAX + 1), '').title).toBeDefined();
  });

  it('описание: 5000 — ок, 5001 → ошибка', () => {
    expect(validateTaskFields('t', 'd'.repeat(DESCRIPTION_MAX)).description).toBeUndefined();
    expect(validateTaskFields('t', 'd'.repeat(DESCRIPTION_MAX + 1)).description).toBeDefined();
  });

  it('ошибки независимы: оба поля невалидны → обе ошибки', () => {
    const errors = validateTaskFields('', 'd'.repeat(DESCRIPTION_MAX + 1));
    expect(errors.title).toBeDefined();
    expect(errors.description).toBeDefined();
  });
});
